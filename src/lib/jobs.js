import pg from 'pg'
import { runDeployJob, updateJob, getJobById } from './deploy.js'

const { Pool } = pg

const QUEUE = 'storefront_deploy'
const MAX_ATTEMPTS = parseInt(process.env.MAX_DEPLOY_ATTEMPTS || '3', 10)
const POLL_INTERVAL_MS = 1000
const RETRY_BACKOFF_MS = 5000

let pool = null

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured')
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
    })
  }
  return pool
}

export async function sendDeployJob({ job_id }) {
  const { rows } = await getPool().query(
    'select pgmq.send($1, $2::jsonb) as msg_id',
    [QUEUE, JSON.stringify({ job_id })]
  )
  return rows[0]?.msg_id || null
}

async function archive(msgId) {
  // pgmq 1.5.1 on Supabase has archive/delete but no `fail` — terminal failures
  // are archived here; the job row status is the source of truth.
  await getPool().query('select pgmq.archive($1, ARRAY[$2::bigint])', [QUEUE, msgId])
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function processBatch() {
  const { rows } = await getPool().query(
    'select * from pgmq.read_with_poll($1, 60, 1, 3000)',
    [QUEUE]
  )

  for (const row of rows) {
    const msgId = row.msg_id
    const payload = row.message
    const jobId = payload?.job_id
    if (!jobId) {
      await archive(msgId)
      continue
    }

    const job = await getJobById(jobId)
    if (!job) {
      await archive(msgId)
      continue
    }

    const attempts = (job.attempts || 0) + 1
    if (attempts > MAX_ATTEMPTS) {
      await updateJob(job.id, {
        status: 'failed',
        error: 'Max retry attempts exceeded',
        completed_at: new Date().toISOString(),
      })
      await archive(msgId)
      continue
    }

    try {
      await updateJob(job.id, { attempts })
      await runDeployJob({ ...job, attempts })
      await archive(msgId)
    } catch (err) {
      console.error(`Job ${jobId} attempt ${attempts}/${MAX_ATTEMPTS} failed:`, err.message)
      if (attempts >= MAX_ATTEMPTS) {
        await updateJob(job.id, {
          status: 'failed',
          error: err.message,
          completed_at: new Date().toISOString(),
        })
        await archive(msgId)
      } else {
        await updateJob(job.id, { status: 'queued', error: err.message })
        await sendDeployJob({ job_id: job.id })
        await archive(msgId)
        await sleep(RETRY_BACKOFF_MS)
      }
    }
  }
}

// Long-running worker: polls pgmq for deploy jobs and processes them serially.
// Concurrency of 1 keeps Vercel API usage predictable at this scale.
export function startWorker() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not configured — deploy worker disabled')
    return
  }

  const run = async () => {
    try {
      await getPool().query('select pgmq.create($1)', [QUEUE])
    } catch {
      // queue already exists
    }
    console.log(`Deploy worker started (queue=${QUEUE}, maxAttempts=${MAX_ATTEMPTS})`)

    for (;;) {
      try {
        await processBatch()
      } catch (err) {
        console.error('Worker batch error:', err)
        await sleep(POLL_INTERVAL_MS)
      }
    }
  }

  run()
}
