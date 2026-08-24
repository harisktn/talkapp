const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')
const { Pool } = require('pg')

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
})

async function initDb() {
    let retries = 5
    while (retries > 0) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    username TEXT NOT NULL,
                    text TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `)
            console.log('database ready')
            return
        } catch (err) {
            retries--
            console.log(`database not ready, retrying... (${retries} attempts left)`)
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }
    throw new Error('could not connect to database after multiple attempts')
}

app.use(express.static(path.join(__dirname, 'public')))

wss.on('connection', async function(ws) {
    console.log('a user connected')

    const result = await pool.query(
        'SELECT username, text, created_at FROM messages ORDER BY created_at ASC LIMIT 50'
    )

    ws.send(JSON.stringify({ type: 'history', messages: result.rows }))

    ws.on('message', async function(data) {
        const parsed = JSON.parse(data.toString())

        await pool.query(
            'INSERT INTO messages (username, text) VALUES ($1, $2)',
            [parsed.username, parsed.text]
        )

        wss.clients.forEach(function(client) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'message', username: parsed.username, text: parsed.text }))
            }
        })
    })

    ws.on('close', function() {
        console.log('a user disconnected')
    })
})

initDb().then(function() {
    server.listen(3000, function() {
        console.log('server running on port 3000')
    })
})