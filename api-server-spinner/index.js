require('dotenv').config();
const express = require('express');
const { generateSlug } = require('random-word-slugs');
const { RunTaskCommand } = require("@aws-sdk/client-ecs");
const Redis = require('ioredis');
const { Server } = require('socket.io');
const { prisma } = require('./utils/prismaClient');
const { z } = require("zod");
const { Kafka } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@clickhouse/client');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const buildQueue = require('./queues/buildQueue');
const { client } = require('./utils/awsClient');
const { version } = require('os');
const githubRoutes = require('./routes/githubRoutes');
const authRoutes = require('./routes/autthRoutes');
const { Worker: ThreadWorker } = require('worker_threads');

const app = express();
app.use(cors()); //mainn cross origin middlware to allow traffic form anywhere

const PORT = 5000;

const clickHouseClient = createClient({
    host: process.env.CH_HOST,
    database: process.env.CH_DB,
    protocol: 'http',
    compression: true,
    timeout: 10000, // Timeout in milliseconds
    // username: process.env.CH_USERNAME,
    // password: process.env.CH_PASSWORD
});



//updated kafka configuration
const kafka = new Kafka({
    clientId: `api-server-receiver_side`,
    brokers: [`${process.env.KAFKA_BROKER}`],
    ssl: {
        rejectUnauthorized: false, // Use true for strict verification
        ca: [fs.readFileSync(path.join(__dirname, 'kafka.pem'), 'utf-8')],
        cert: fs.readFileSync(path.join(__dirname, 'service.cert'), 'utf-8'),
        key: fs.readFileSync(path.join(__dirname, 'service.key'), 'utf-8'),
    },
})


//create kafka consumer instance and try to consume logs by initializing them
const consumer = kafka.consumer({ groupId: 'builder-logs-consumer' });

//create new socket srever for logs subscribing and pushing
// const io = new Server({ cors: '*' }); // listens all origins

//middlewares

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//routes
app.use('/api/github', githubRoutes);
app.use('/api/auth', authRoutes);
async function main() {
    // Log to indicate the connection attempt
    console.log('Attempting to connect to the database...');

    try {
        // Run a simple query to test the connection
        const users = await prisma.user.findMany();

        // Log successful query result
        console.log('Successfully connected to the database and fetched users:', users);
    } catch (error) {
        // Log any error that happens during the query
        console.error('Error connecting to the database or fetching users:', error);
    }
}

//kafka consumer function
async function logsConsumer() {
    try {
        console.log("Consumer trying to connect....");
        await consumer.connect();
        console.log("Consumer connection successful..");

        // Subscribe to topic so partition is assigned by Zookeeper
        await consumer.subscribe({ topics: ['builder-logs'], fromBeginning: true });

        // Run and process consumer batch-wise
        await consumer.run({
            eachBatch: async function ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) {
                // Take batch from batches
                console.log(`Received ${batch.messages.length} messages...`);

                for (const message of batch.messages) {
                    if (!message.value) continue;

                    try {
                        // Parse the already stringified message directly
                        const logMessage = JSON.parse(message.value.toString());
                        console.log('lgmsg', logMessage);
                        console.log("raw msg", message);
                        console.log("msg val tostring", message.value.toString());

                        const {
                            PROJECT_ID,
                            DEPLOYMENT_ID,
                            log,
                            timestamp,
                            logLevel,
                            fileName,
                            fileSize,
                            fileSizeInBytes,
                            timeTaken,
                        } = logMessage;

                        console.log(`Log received: ${log} | Deployment: ${DEPLOYMENT_ID} | Project: ${PROJECT_ID}`);

                        // Insert log into ClickHouse with additional metadata
                        const logEntry = {
                            event_id: uuidv4(),
                            project_id: PROJECT_ID,
                            deployment_id: DEPLOYMENT_ID,
                            log_message: log,
                            log_level: logLevel || 'info',
                            file_name: fileName || null,
                            file_size: fileSize || null,
                            file_size_in_bytes: fileSizeInBytes || null,
                            time_taken: timeTaken || null,
                        };

                        const { query_id } = await clickHouseClient.insert({
                            table: 'log_events',
                            values: [logEntry],
                            format: 'JSONEachRow',
                        });

                        console.log(`Log inserted to ClickHouse with query ID: ${query_id}`);
                        resolveOffset(message.offset);
                        await commitOffsetsIfNecessary(message.offset);
                        await heartbeat();
                    }
                    catch (err) {
                        console.error("Error processing message:", err.message);
                    }
                }
            }
        });
    }
    catch (error) {
        console.log("Consumer connection error:", error.message);
    }
}

const startWorkerThreads = () => {
    //update path to point to the worker folder
    const workerFiles = ['deploymentWorker.js', 'failedQueueWorker.js', 'webHooksWorker.js'].map((file) =>
        path.join(__dirname, 'worker', file));;

    //start each workrt using seperate pareller threads
    workerFiles.forEach((file) => {
        const workerThread = new ThreadWorker(file);
        console.log(`started worker thread foe ${file}`);
        workerThread.on('error', (err) => {
            console.error(`Error in worker thread for ${file}`, err);
        });
    });
}
//start workers from here by paraller multithreading


// io.on('connection', (socket) => {
//     socket.on('suscribe', function (channel) {
//         socket.join(channel);
//         socket.emit('message', `joined for ${channel}`);
//     });
// });
// const suscriber = new Redis(process.env.REDDIS_HOST);

//function which suscribes to logs and send user specific logs to their own data
// async function emitMessages() {
//     console.log("Suscribed to logs....");
//     //her we will suscribe all logs whic are in format logs:* as we have published that using this as channel name
//     suscriber.psubscribe('logs:*');
//     console.log("Suscribed to pattern logs:*");
//     suscriber.on('pmessage', (pattern, channel, message) => {
//         console.log("chname: " + channel);
//         io.to(channel).emit('message', message);
//     })
// }

// io.listen(9001, () => console.log("listening on port 9002"));



//inttialize ecs client here
// const client = new ECSClient({
//     region: process.env.AWS_REGION,
//     credentials: {
//         accessKeyId: process.env.AWS_ACCESSKEY,
//         secretAccessKey: process.env.AWS_SECRETACCESSKEY
//     }
// });
//make con=figuration object for task and cluster
const config = {
    CLUSTER: process.env.AWS_CLUSTER_NAME,
    TASK: 'git_project_cloner_task:4'
}

//my subnets
// subnet-0e0c97b6f83bfc538
// subnet-08a60214836f38b79
// subnet-0c4be927b2f4c3790

//for creating project this route wil be used
app.post('/create-project', async function (req, res) {
    try {
        //validate using zod

        //created validator schema
        const createProjectSchema = z.object({
            name: z.string().min(1, "project name is required"),
            gitUrl: z.string().url("Invalid git url"),
            description: z.string().optional(),
            ownerId: z.number().int().positive("invallid ownerid"),
        });

        //parse check body as it is according to schema
        const isValidated = createProjectSchema.parse(req.body);
        if (isValidated.error) return res.status(404).json({ error: isValidated.error });

        //after proper validation insert that data into database
        const newProject = await prisma.project.create({
            data: {
                name: isValidated.name,
                gitUrl: isValidated.gitUrl,
                description: isValidated.description || null,
                owner: {
                    connect: { id: isValidated.ownerId }, // Ensure `newUser.id` exists in the database
                }
            },
        });

        //respond with project creation siccess
        res.status(200).send({
            success: true,
            message: 'Project created successfully!',
            project: isValidated.ownerId
        });
    }
    catch (e) {
        res.status(401).send({
            succsee: false,
            message: 'problem for creating project',
            error: e.message
        });
    }
});

//tester functin for creating user
async function createUser() {
    try {
        //creation query 
        const newUser = await prisma.user.create({
            data: {
                email: "example@example.com", // Replace with the user's email
                name: "John Doe", // Optional, can be `null`
                role: "USER", // Replace if you have other roles like ADMIN
            },
        });

        console.log('Created User:', newUser);

    }
    catch (e) {
        console.log('Error creating user internal error:', e.message);
    }
}

//for getting user projects using ownerId as an unique foreign key realtion
app.get("/projects/:ownerId", async function (req, res) {
    try {
        const ownerId = parseInt(req.params.ownerId, 10);
        if (isNaN(ownerId)) {
            return res.status(400).send({
                success: false,
                message: "Invalid ownerId ptovidee",
            });
        }
        //otherwise fetach all projects from the owner
        const projects = await prisma.project.findMany({
            where: { ownerId },
            include: {
                deployments: true,
                owner: true
            }
        });

        //return all found projects from that ownerId
        res.status(200).send({
            success: true,
            data: projects
        });
    }
    catch (e) {
        return res.status(404).send({
            success: false,
            message: 'response error from api',
            error: e.message
        });
    }
});


//main deployer actual via bullmq queue

app.post('/deploy', async (req, res) => {
    //all is dependent on just projectId
    try {
        //make zod schema for deployment validation
        const deploymentSchema = z.object({
            projectId: z.string().uuid("Invalid project ID"), // Ensure it matches UUID format
            environment: z.enum(["DEV", "STAGING", "PROD"], "Invalid environment").default("STAGING"),
            status: z.enum(["INACTIVE", "ACTIVE", "FAILED"]).optional().default("INACTIVE"),
            version: z.string().optional(), // Optional version or tag
            autoDeploy: z.boolean().optional().default(false), // Add autoDeploy to the schema
        });

        // Step 1: Validate input
        const validatedData = deploymentSchema.parse(req.body);

        //generate url if user provided custom uri handle logic for it otherwiswe make use of default name
        const generatedUri = validatedData.url || `http://${validatedData.projectId}.localhost:9000`;

        // Step 2: Check if project exists
        const project = await prisma.project.findUnique({
            where: { id: validatedData.projectId },
        });



        if (!project) {
            return res.status(404).send({
                success: false,
                message: "Project not found",
            });
        }
        //first check there is nor running deployment


        //mark tht deploymenr entry in the database
        const newDeployment = await prisma.deployment.create({
            data: {
                projectId: validatedData.projectId,
                environment: validatedData.environment,
                status: validatedData.status,
                url: generatedUri,
                version: validatedData.version || "v1.0.0", // Provide a default version
                autoDeploy: validatedData.autoDeploy, // Include autoDeploy here
            },
            //this include is just like populate() in mongodb or fetch_assoc() in php and readRecursive() in ruby as an powerful tree of tech stacks 
            include: {
                project: true, // Fetch related project data
            },
        });
        console.log("deployment added in prisma for deployment id", newDeployment.id);
        //here add job to the deployment queue inseted of deploying it directly
        await buildQueue.add('deploy', { deploymentId: newDeployment.id, projectId: newDeployment.project.id, environment: validatedData.environment, gitUrl: newDeployment.project.gitUrl, version: validatedData.version || "v1.0.0" });
        console.log("job added in queue");

        return res.json({ status: 'queued', data: { deploymentId: newDeployment.id, domain: newDeployment.url } })

    }
    catch (e) {
        return res.status(500).send({
            success: false,
            message: 'internal service error for building deployment',
            error: e.message
        });
    }
});
//get single project using projectId
// Example with Express.js
app.get("/api/project/:id", async (req, res) => {
    const { id } = req.params;
    console.log("arrived id", id);
    try {
        const project = await prisma.project.findUnique({
            where: { id: id },
        });
        if (!project) {
            return res.status(404).json({ error: "Project not found" });
        }
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch project" });
    }
});


//this will make deployment of the project
app.post('/deploy-project', async function (req, res) {
    const { gitUrl, slug } = req.body;
    const projectSlug = slug ? slug : generateSlug();

    //spin container as docker task
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: ['subnet-0e0c97b6f83bfc538', 'subnet-08a60214836f38b79', 'subnet-0c4be927b2f4c3790'],
                securityGroups: ['sg-0bf9e7e682e1bed1a ']
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'task_cloner_image',
                    environment: [
                        { name: 'GIT_REPOSITORY__URL', value: gitUrl },
                        { name: 'PROJECT_ID', value: projectSlug }
                    ]
                }
            ]
        }
    })

    await client.send(command);
    return res.json({ status: 'queued', data: { projectSlug, url: `http://${projectSlug}.localhost:9000` } });
});
// emitMessages();  //manager kogs emitting service from redddis pub sub

logsConsumer(); //this will display logs that are received by consumer and going to store in clickhouse

//for getting logs using deployment id
app.get('/getLogs/:id', async function (req, res) {
    try {
        const id = req.params.id;

        //finder query
        const logs = await clickHouseClient.query({
            query: `SELECT event_id, deployment_id, log, created_at from log_events where deployment_id = {deployment_id:String}`,
            query_params: {
                deployment_id: id
            },
            format: 'JSONEachRow'
        });

        const rawLogs = await logs.json();

        return res.json({ logs: rawLogs });

    }
    catch (e) {
        res.status(401).send({
            success: false,
            message: 'internal error',
            error: e.message
        });
    }
});

// Function to check the connection
async function testClickHouseConnection() {
    try {
        const result = await clickHouseClient.query({
            query: 'SELECT version()',  // Basic query to check the server version
            format: 'JSONEachRow',
        }).then(response => {
            if (response.data && response.data.length > 0) {
                console.log('ClickHouse connected successfully! Server version:', response.data[0].version);
            } else {
                console.log('No data returned from ClickHouse.');
            }
        });
    } catch (error) {
        console.error('Failed to connect to ClickHouse:', error.message);
    }
}
(async () => {
    const jobCounts = await buildQueue.getJobCounts();
    console.log('Job counts:', jobCounts);
})();

//start worker thread here to hit  our woorker in acitive mode
startWorkerThreads();

// Call the function
// testClickHouseConnection();
app.listen(PORT, () => console.log(`API Server Running..${PORT}`));