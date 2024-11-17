// index.js
const express = require('express');
const app = express();
const port = process.env.PORT || 4000;
const bodyParser = require('body-parser');
app.use(bodyParser.json());
const { Client } = require('pg');
const nodemailer = require('nodemailer');
require('dotenv').config();
const multer = require('multer');
const path = require('path');


const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'my_ott',
    password: 'root',
    port: 5432,
});

client.connect()
    .then(() => console.log('Connected to PostgreSQL database'))
    .catch(err => console.error('Connection error', err));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads'); // Directory where files will be saved
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ storage });

// Define a route
app.get('/', (req, res) => {
    res.send('Hello World!');
});

// Start the server
app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();


const sendOTPViaEmail = async (email, otp) => {
    let transporter = nodemailer.createTransport({
        service: 'gmail', // Use Gmail service
        auth: {
            // user: 'devharshilrpatel@gmail.com', // Your Gmail address
            // pass: 'kyfs edkn ahuh kjcw' // Your Gmail password or app-specific password
            user: 'team.myott@gmail.com', // Your Gmail address
            pass: 'pbdg gips pxxe bfpm' // Your Gmail password or app-specific password
        }
    });



    await transporter.sendMail({
        from: '"OTP Verification" <your-email@gmail.com>',
        to: email,
        subject: 'Your OTP Code',
        text: `Your OTP code is ${otp}. It is valid for 10 minutes.`
    });
};


// sign in process
app.post('/api/create-user', async (req, res) => {
    const { email, mobile_number } = req.body;
    if (!email && !mobile_number) {
        return res.status(401).json({
            statuscode: 401,
            message: "Please provide email address and mobile number.",
            error: true
        });
    }

    const otp = generateOTP();

    try {
        // Check if a user already exists with the provided email or mobile number
        const checkUserQuery = `
            SELECT * FROM users WHERE email = $1 OR mobile_number = $2;
        `;
        const checkUserValues = [email, mobile_number];
        const checkUserResult = await client.query(checkUserQuery, checkUserValues);

        let newUser;

        if (checkUserResult.rows.length > 0) {
            const existingUser = checkUserResult.rows[0];

            // Check if email or mobile_number mismatch with the stored values
            if ((existingUser.email && existingUser.email !== email) ||
                (existingUser.mobile_number && existingUser.mobile_number !== mobile_number)) {
                return res.status(401).json({
                    statuscode: 401,
                    message: "Email and mobile number does not match.",
                    error: true
                });
            }

            // User exists and matches, update last login and OTP
            const updateUserQuery = `
                UPDATE users SET otp = $1, last_login = NOW()
                WHERE id = $2
                RETURNING *;
            `;
            const updateUserValues = [otp, existingUser.id];
            const updateUserResult = await client.query(updateUserQuery, updateUserValues);

            newUser = updateUserResult.rows[0];
        } else {
            // User doesn't exist, insert a new user
            const insertUserQuery = `
                INSERT INTO users(email, mobile_number, otp, status)
                VALUES($1, $2, $3, $4)
                RETURNING *;
            `;
            const insertUserValues = [email, mobile_number, otp, "InActive"];
            const insertUserResult = await client.query(insertUserQuery, insertUserValues);

            newUser = insertUserResult.rows[0];
        }

        // Send OTP via Email or SMS
        if (email) {
            await sendOTPViaEmail(email, otp);
        }

        res.status(201).send({
            message: 'OTP sent successfully. User processed.',
            statuscode: 201,
            user: newUser,
            error: false

        });

    } catch (err) {
        console.error('Error processing user:', err.message);
        res.status(401).json({ message: err.message, statuscode: 401, error: true });
    }

    console.log("user", req.body);
});


app.post('/api/verify-user', async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(401).json({ message: 'Please provide both email and OTP.', statucode: 401, error: true });
    }

    try {
        // Check if the user exists
        const queryText = `
            SELECT * FROM users 
            WHERE email = $1
        `;
        const values = [email];
        const result = await client.query(queryText, values);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'User does not exist.', statucode: 401, error: true });
        }

        // Log the OTPs for debugging
        console.log("Stored OTP:", user.otp);
        console.log("Provided OTP:", otp);

        // Handle first-time verification
        if (user.status === 'InActive') {
            if (Number(user.otp) !== Number(otp)) {
                return res.status(400).json({ message: 'Invalid OTP for verification.', statucode: 401, error: true });
            }

            // Update user status to Active and set last_login
            const updateText = `
                UPDATE users 
                SET status = 'Active', last_login = NOW() 
                WHERE email = $1
                RETURNING *;
            `;
            const updatedUserResult = await client.query(updateText, values);
            const updatedUser = updatedUserResult.rows[0];

            return res.status(200).json({
                message: 'User verified successfully for the first time.',
                user: updatedUser,
                statucode: 200,
                error: false
            });
        }

        // Handle subsequent logins for already verified users
        if (user.status === 'Active') {
            if (Number(user.otp) !== Number(otp)) {
                return res.status(401).json({ message: 'Invalid OTP for login.', statucode: 401, error: true });
            }

            // Update last_login time for repeat login
            const updateLoginText = `
                UPDATE users 
                SET last_login = NOW()
                WHERE email = $1
                RETURNING *;
            `;
            const updatedLoginResult = await client.query(updateLoginText, values);
            const updatedUser = updatedLoginResult.rows[0];

            return res.status(200).json({
                message: 'User login successful.',
                user: updatedUser,
                statucode: 200,
                error: false
            });
        }

    } catch (err) {
        console.error('Error verifying user:', err.message);
        res.status(401).json({ message: err.message, statucode: 401, error: true });
    }

    console.log("Verification attempt for user:", req.body);
});








// add movie process

function createSlug(movieName) {
    return movieName
        .toLowerCase()             // Convert to lowercase
        .replace(/\s+/g, '-')      // Replace spaces with hyphens
        .replace(/[^a-z0-9\-]/g, ''); // Remove any character that isn't a letter, number, or hyphen
}


app.post('/api/add-movie', upload.fields([{ name: 'thumbnail' }, { name: 'poster' }]), async (req, res) => {
    const { movie_name, description, movie_link, trailer, movie_duration } = req.body;

    const slug = createSlug(movie_name);

    const { thumbnail, poster } = req.files;

    if (!movie_name || !description || !movie_link || !trailer || !slug || !movie_duration) {
        return res.status(400).json({ message: 'All fields are required.', statucode: 400, error: true });
    }

    try {
        // Validate file uploads
        const thumbnailPath = thumbnail ? `uploads/${thumbnail[0].filename}` : null;
        const posterPath = poster ? `uploads/${poster[0].filename}` : null;

        // Insert movie details into the database
        const insertMovieQuery = `
            INSERT INTO movies (movie_name, description, thumbnail, poster, movie_link, trailer, slug, movie_duration)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;
        const values = [
            movie_name,
            description,
            thumbnailPath,
            posterPath,
            movie_link,
            trailer,
            slug,
            movie_duration
        ];
        const result = await client.query(insertMovieQuery, values);

        res.status(201).json({
            message: 'Movie added successfully',
            movie: result.rows[0],
            statucode: 201,
            error: false
        });
    } catch (err) {
        console.error('Error adding movie:', err.message);
        res.status(500).json({ message: err.message, statucode: 500, error: true });
    }
});