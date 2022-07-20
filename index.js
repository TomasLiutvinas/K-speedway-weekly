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

var populateDatabase = function(sessionId){
	let sessionData = await fetchData(`https://karts.theamazingtom.com/api/speedway/GetSessionData/${sessionId}`);

	// Try get current day [sessionData.Date]
	// if day not found create the day

	// day creation: 
		// Title[sessionData.Date]
		// Configuration[unknown]
		// Date[sessionData.Date]
		// Weather[pull weather from somewhere?]
		// Comments[null]
		// Week[calculate week of the year]

	// when day created or found
	// try get current session
	// if current session found delete all session data

	// when session data deleted or session not found
	// create new session

	// session creation:
		// Day[sessionData.Date{ref}]
		// Time[sessionData.Time]
		// Type[determine type, or upgrade API to return type]
		// SpeedwaySessionID[sessionId]

	// when session created
	// bulk add laps

	// lap set [...] creation:
		// Session[createdSession]
		// LapNo[index of :sessionData.LapTimes[...].data[index]]
		// LapTime[sessionData.LapTimes[...].data[index]]
		// Position[sessionData.LapTimes[...].data[index]] Only if sesion type is race
		// Kart[sessionData.LapTimes[i].label for all entries in a set]
		// Driver[unknown]
}

var init = async function (){
	if (testing) {
		let sessionId = await fetchData('https://karts.theamazingtom.com/api/speedway/GetCurrentSessionId');
		console.log(sessionData.LapTimes[0].data);
		populateDatabase(sessionId);
	}

	while (true && !testing) {
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