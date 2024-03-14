
// Import required libraries
const amqp = require('amqplib');
const Redis = require('ioredis');

// RabbitMQ connection string
const rabbitUrl = 'amqp://localhost';

// Redis connection
const redis = new Redis();

// Lock key for Redis
const lockKey = 'counter_lock';

// Function to acquire a lock in Redis
async function acquireLock() {
    const result = await redis.set(lockKey, 'locked', 'NX', 'EX', 10); // Set lock with expiration of 10 seconds
    return result === 'OK';
}

// Function to release the lock in Redis
async function releaseLock() {
    await redis.del(lockKey);
}

// Function to increment the counter in Redis
async function incrementCounter() {
    // Acquire lock to prevent race conditions
    const lockAcquired = await acquireLock();
    if (!lockAcquired) {
        console.log('Failed to acquire lock. Skipping counter increment.');
        return;
    }

    try {
        await redis.incr('counter');

        // Notify other processes via RabbitMQ
        await notifyCounterUpdated();

        console.log('Counter incremented successfully.');
    } catch (error) {
        console.error('Error incrementing counter:', error);
    } finally {
        // Release the lock
        await releaseLock();
    }
}

// Function to notify other processes via RabbitMQ when the counter is updated
async function notifyCounterUpdated() {
    const connection = await amqp.connect(rabbitUrl);
    const channel = await connection.createChannel();

    const exchange = 'counter_exchange';

    await channel.assertExchange(exchange, 'fanout', { durable: false });

    channel.publish(exchange, '', Buffer.from('Counter updated'));
    console.log('Notification sent: Counter updated');

    await channel.close();
    await connection.close();
}

// Function to consume messages from RabbitMQ
async function consume() {
    const connection = await amqp.connect(rabbitUrl);
    const channel = await connection.createChannel();

    // Create a queue
    const queue = 'counter_queue';
    await channel.assertQueue(queue, { durable: true });

    console.log('Waiting for messages...');

    // Consume messages
    channel.consume(queue, async (msg) => {
        const message = JSON.parse(msg.content.toString());

        // Process the message
        console.log('Received message:', message);
        await incrementCounter();

        // Acknowledge the message
        channel.ack(msg);
    });
}

// Function to produce messages to RabbitMQ
async function produce() {
    const connection = await amqp.connect(rabbitUrl);
    const channel = await connection.createChannel();

    // Create a queue
    const queue = 'counter_queue';
    await channel.assertQueue(queue, { durable: true });

    // Produce messages
    setInterval(() => {
        const message = { timestamp: Date.now() };
        channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
        console.log('Sent message:', message);
    }, 1000);
}

// Start consuming messages
consume();

// Start producing messages
produce();

