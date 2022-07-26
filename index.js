// Somewhere DB connection is leaked

// Routing
const express = require('express');
const app = express();

// Cors
var cors = require('cors');
app.use(cors());
app.use(express.json());

// Env Vars
require('dotenv').config();

// API calls
const fetch = require('axios');

// Database
const mariadb = require('mariadb');

// Constants
const testing = false;
const pollingRate = 1000 * 60 * 1;

// Functions

async function fetchData(url) {
	let data = await fetch
		.get(url)
		.then(res => {
			return res.data;
		})
		.catch(err => {
			console.log('Error: ', err)
		})
	return data;
}

function getWeekNumber() {
	let d = new Date();
	// Copy date so don't modify original
	d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	// Set to nearest Thursday: current date + 4 - current day number
	// Make Sunday's day number 7
	d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
	// Get first day of year
	var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	// Calculate full weeks to nearest Thursday
	var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
	// Return array of year and week number
	return weekNo;
}

function getStringTimeForDatabase(time) {
	//73.421997070312
	var minutes = Math.trunc(time / 60);
	var seconds = Math.trunc(time % 60);
	var ms = Math.round(time % 1 * 1000);

	if (Math.trunc(time / 60) < 10) {
		minutes = "0" + minutes;
	}

	if (seconds < 10) {
		seconds = "0" + seconds;
	}

	if (Math.round(time % 1 * 1000) < 10) {
		ms = "00" + ms;
	} else if (ms < 100) {
		ms = "0" + ms;
	}

	return `00:${minutes}:${seconds}.${ms}`;
}

var populateDatabase = async function(){
	let sessionData = await fetchData(`https://karts.theamazingtom.com/api/speedway/GetSessionData/${previousSessionHash}`);
	if(sessionData.Type == 'PRACTICE'){ sessionData.Type = 'SIMPLE'; }
	
	console.log(`Processing session: ${sessionData.Time}`);

	const pool = mariadb.createPool({
		host: process.env.DB_HOST,
		user: process.env.DB_USER,
		password: process.env.DB_PWD,
		database: process.env.DB_K
	});

	let connection = await pool.getConnection();

	// Try get current day [sessionData.Date]
	// if day not found create the day
	let currentDayId;
	const currentDay = await connection.query(`
		SELECT DayID 
		FROM Days
		WHERE DATE = '${sessionData.Date}'
	`);
	
	if(currentDay.length > 0){
		currentDayId = currentDay[0].DayID;
	} else {
		// day creation:
			// Title[sessionData.Date]
			// Configuration[unknown]
			// Date[sessionData.Date]
			// Weather[pull weather from somewhere?]
			// Comments[null]
			// Week[calculate week of the year]
		let insertResult = await connection.query(`
			INSERT INTO \`speedway\`.\`Days\` (\`Title\`, \`Date\`, \`Weather\`, \`Week\`) 
			VALUES (
				'${sessionData.Date}',
				'${sessionData.Date}',
				'UNKNOWN',
				${getWeekNumber()}
			);
		`);
		
		// what the fuck is this, SOMETIMES(?) returning {id}n instead of just the ID, HELP ME PLS
		try{
			currentDayId = insertResult.insertId.replace('n', '');
		} catch(err){
			currentDayId = insertResult.insertId;
		}
	}

	let existingSessionId = await connection.query(`
		SELECT SessionID 
		FROM Sessions
		WHERE Day = '${currentDayId}'
			  AND
			  Time = '${sessionData.Time}:00'
	`);

	// when day created or found
	// try get current session
	if (existingSessionId.length > 0){
		// No longer deleting due to duplicates happening from human error
		console.log(`Something is not right ${existingSessionId[0].SpeedwaySessionHash}`)
		// let deleteResult = await connection.query(`
		// 	DELETE FROM \`speedway\`.\`Sessions\`
		// 	WHERE Day = ${currentDayId}
		// 		  AND
		// 		  Time = '${sessionData.Time}:00'
		// `);
		// if current session found delete ALL session data
	}
	
	// session creation:
	// Day[reference to current day]
	// Time[sessionData.Time]
	// Type[sessionData.Type]
	// SpeedwaySessionHash[sessionToProcessHash]

	let insertResult = await connection.query(`
		INSERT INTO \`speedway\`.\`Sessions\` (\`Day\`, \`Time\`, \`Type\`, \`SpeedwaySessionHash\`) 
		VALUES (
			 ${currentDayId},
			'${sessionData.Time}:00',
			'${sessionData.Type}',
			'${previousSessionHash}'
		);
	`);

	const currentSessionId = insertResult.insertId;

	// when session created
	// bulk add laps
	// lap set [...] creation:
	// Session[createdSession]
	// LapNo[index of :sessionData.LapTimes[...].data[index]]
	// LapTime[sessionData.LapTimes[...].data[index]]
	// Position[sessionData.LapTimes[...].data[index]] Only if sesion type is race
	// Kart[sessionData.LapTimes[i].label for all entries in a set]
	// Driver[unknown]

	let bulkInsertData = [];
	let bulkInsertQuery;

	if (sessionData.Type == 'RACE') {
		// Not supported yet
		// bulkInsertQuery = `INSERT INTO \`speedway\`.\`Laps\` 
		// (\`Session\`, \`LapNo\`, \`LapTime\`, \`Position\`, \`Kart\`) VALUES (?, ?, ?, ?, ?);`
	} else if (sessionData.Type == 'SIMPLE') {
		sessionData.LapTimes.forEach((lapTimeEntry, kartIndex) => {
			lapTimeEntry.data.forEach((lapTime, lapIndex) => {
				bulkInsertData.push([currentSessionId, lapIndex + 1, getStringTimeForDatabase(lapTime), lapTimeEntry.label.replace(/\D/g, '')]);
			})
		});

		bulkInsertQuery = `INSERT INTO \`speedway\`.\`Laps\` 
		(\`Session\`, \`LapNo\`, \`LapTime\`, \`Kart\`) VALUES (?, ?, ?, ?);`
	} else {
		console.log(`Unknown session type ${sessionData.Type}`);
		throw 'Unknown session type';
	}

	try {
		console.log('pre-bulk');
		console.log(previousSessionHash);

		await connection.batch(bulkInsertQuery, bulkInsertData, (err, res, meta) => {
			console.log('post-bulk');
			console.log(previousSessionHash);
			if (err) {
				console.error("Error loading data, reverting changes: ", err);
			} else {
				console.log(res);  // never get called? but bulk adding works
				console.log(meta); // never get called
			}
		});
	} catch (err) {
		console.log(`ERR:${err}`);
	}

	connection.end();
	console.log('closed connection');
}

var executePoll = async function(){
	const currentSessionHash = await fetchData('https://karts.theamazingtom.com/api/speedway/GetCurrentSessionHash');
	console.log('Session check:');
	console.log(`Previous: ${previousSessionHash}`);
	console.log(`Current-: ${currentSessionHash}`);
	
	if (isFirstRun){
		console.log('First run, setting lastSessionHash');
		previousSessionHash = currentSessionHash;
		console.log('first-run-update');
		console.log(`Updated to ${currentSessionHash}`);
		isFirstRun = false;
	} 
	
	const sessionChanged = currentSessionHash != previousSessionHash;

	if(sessionChanged) {
		console.log('Session changed.');
		await populateDatabase(previousSessionHash);
		console.log(`Updating from ${previousSessionHash}`);
		console.log(`Updating to - ${currentSessionHash}`);
		previousSessionHash = currentSessionHash;
	} else {
		console.log('Session not changed.');
	}
}

var init = async function (){
	if (testing) {
		await populateDatabase();
	} else { 
		setInterval(() => executePoll(), pollingRate);	
	}
}

let isFirstRun = true;
let previousSessionHash;
init();
// Need to get current URL
// If current URL != last URL process the previous URL to the database