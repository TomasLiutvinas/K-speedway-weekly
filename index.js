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
const testing = true;
const tables = ['Configurations', 'Days', 'Laps', 'Runs'];

// Variables
let currentSessionId;
let lastSessionId;
let pollingRate = 45000

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

var populateDatabase = async function(sessionId){
	let sessionData = await fetchData(`https://karts.theamazingtom.com/api/speedway/GetSessionData/${sessionId}`);
	if(sessionData.Type == 'PRACTICE'){ sessionData.Type = 'SIMPLE'; }

	const pool = mariadb.createPool({
		host: process.env.DB_HOST,
		user: process.env.DB_USER,
		password: process.env.DB_PWD,
		database: process.env.DB_K
	});

	let connection = await pool.getConnection();

	const currentDay = await connection.query(`
		SELECT DayID 
		FROM Days
		WHERE DATE = '${sessionData.Date}'
	`);

	let currentDayId;
	// Try get current day [sessionData.Date]
	// if day not found create the day
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
		
		// what the fuck is this, returning {id}n instead of just the ID, HELP ME PLS
		currentDayId = insertResult.insertId.replace('n','');
	}

	let currentSessionId;
	let currentSession = await connection.query(`
		SELECT SessionID 
		FROM Sessions
		WHERE Day = '${currentDayId}'
			  AND
			  Time = '${sessionData.Time}:00'
	`);

	// when day created or found
	// try get current session
	if(currentSession.length > 0){
		currentSessionId = currentSession[0].SessionID;
		let deleteResult = await connection.query(`
			DELETE FROM \`speedway\`.\`Sessions\`
			WHERE Day = ${currentDayId}
				  AND
				  Time = '${sessionData.Time}:00'
		`);
		// if current session found delete ALL session data
		console.log(`Deleted: ${deleteResult}`);
	}
	
	// session creation:
	// Day[sessionData.Date{ref}]
	// Time[sessionData.Time]
	// Type[determine type, or upgrade API to return type]
	// SpeedwaySessionID[sessionId]

	let insertResult = await connection.query(`
		INSERT INTO \`speedway\`.\`Sessions\` (\`Day\`, \`Time\`, \`Type\`, \`SpeedwaySessionID\`) 
		VALUES (
			 ${currentDayId},
			'${sessionData.Time}:00',
			'${sessionData.Type}',
			'${sessionId}'
		);
	`);

	currentSessionId = insertResult.insertId;
	
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
	} else if(sessionData.Type == 'SIMPLE'){
		sessionData.LapTimes.forEach((lapTimeEntry, kartIndex) => {
			lapTimeEntry.data.forEach((lapTime, lapIndex) => {
				bulkInsertData.push([currentSessionId, lapIndex, getStringTimeForDatabase(lapTime), lapTimeEntry.label.replace(/\D/g, '')]);
			})
		});

		bulkInsertQuery = `INSERT INTO \`speedway\`.\`Laps\` 
		(\`Session\`, \`LapNo\`, \`LapTime\`, \`Kart\`) VALUES (?, ?, ?, ?);`
	} else { 
		console.log(`Unknown session type ${sessionData.Type}`);
		throw 'Unknown session type';
	}

	try {
		await connection.batch(bulkInsertQuery, bulkInsertData, (err, res, meta) => {
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

var init = async function (){
	if (testing) {
		let sessionId = await fetchData('https://karts.theamazingtom.com/api/speedway/GetCurrentSessionId');
		await populateDatabase(sessionId);
		return "";
	}

	while (true && !testing) {
		console.log('polling');
		setTimeout(() => {
			let res = fetchData(`https://karts.theamazingtom.com/api/speedway/GetSessionData/`);

			if (currentSessionId.Time != res.Time) {
				lastSessionId = currentSessionId;
				populateDatabase(lastSessionId);
			}

			currentSessionId = res;
		}, pollingRate);
	}
}

init();
// Need to get current URL
// If current URL != last URL process the previous URL to the database