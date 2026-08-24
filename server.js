const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')
const { Pool } = require('pg')
const bcrypt = require('bcrypt')
const session = require('express-session')

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
})

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'devsecret',
    resave: false,
    saveUninitialized: false,
    store: new session.MemoryStore(),
    cookie: { httpOnly: true }
})

app.use(express.json())
app.use(sessionMiddleware)
app.use(express.static(path.join(__dirname, 'public')))

async function initDb() {
    let retries = 5
    while (retries > 0) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
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

app.post('/register', async function(req, res) {
    const { username, password } = req.body
    if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' })
    }
    try {
        const hash = await bcrypt.hash(password, 10)
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
            [username, hash]
        )
        req.session.user = { id: result.rows[0].id, username: result.rows[0].username }
        res.json({ username: result.rows[0].username })
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'username already taken' })
        }
        res.status(500).json({ error: 'server error' })
    }
})

app.post('/login', async function(req, res) {
    const { username, password } = req.body
    if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' })
    }
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        )
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'invalid credentials' })
        }
        const user = result.rows[0]
        const match = await bcrypt.compare(password, user.password_hash)
        if (!match) {
            return res.status(401).json({ error: 'invalid credentials' })
        }
        req.session.user = { id: user.id, username: user.username }
        res.json({ username: user.username })
    } catch (err) {
        res.status(500).json({ error: 'server error' })
    }
})

app.post('/logout', function(req, res) {
    req.session.destroy()
    res.json({ ok: true })
})

app.get('/me', function(req, res) {
    if (req.session.user) {
        res.json({ username: req.session.user.username })
    } else {
        res.status(401).json({ error: 'not logged in' })
    }
})

wss.on('connection', function(ws, req) {
    sessionMiddleware(req, {}, async function() {
        if (!req.session || !req.session.user) {
            ws.close()
            return
        }

        const user = req.session.user
        console.log(user.username + ' connected')

        const result = await pool.query(
            'SELECT username, text, created_at FROM messages ORDER BY created_at ASC LIMIT 50'
        )

        ws.send(JSON.stringify({ type: 'history', messages: result.rows }))

        ws.on('message', async function(data) {
            const parsed = JSON.parse(data.toString())
            if (!parsed.text) return

            await pool.query(
                'INSERT INTO messages (username, text) VALUES ($1, $2)',
                [user.username, parsed.text]
            )

            wss.clients.forEach(function(client) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'message',
                        username: user.username,
                        text: parsed.text
                    }))
                }
            })
        })

        ws.on('close', function() {
            console.log(user.username + ' disconnected')
        })
    })
})

initDb().then(function() {
    server.listen(3000, function() {
        console.log('server running on port 3000')
    })
})