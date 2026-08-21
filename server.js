const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({server})

app.use(express.static(path.join(__dirname, 'public')))

wss.on('connection', function(ws) {
    console.log('a user connected')

    ws.on('message', function(data) {
        wss.clients.forEach(function(client) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data.toString())
            }
        })
    })

    ws.on('close', function() {
        console.log('a user disconnected')
    })
})

server.listen(3000, function() {
    console.log('server running on port 3000')
})



