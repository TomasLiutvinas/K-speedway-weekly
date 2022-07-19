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
let currentSessionData;
let previousSessionData;
let pollingRate = 45000

// Functions

async function fetchData(url) {
	let data = await (await (fetch(url)
		.then(res => {
			return res;
		})
		.catch(err => {
			console.log('Error: ', err)
		})
	))
	return data
}

var populateDatabase = function(sessionData){
	try {
      mariadb.createConnection({
			host: process.env.DB_HOST,
			user: process.env.DB_USER,
			password: process.env.DB_PWD,
			database: process.env.DB_K
		}).then(conn => {
			conn.query(`SELECT DayID FROM Days WHERE DATE = '${sessionData.Date}'`)
				.then(rows => {
					if(rows.length == 1){
						console.log(rows);
						// Use existing day
					}else{
						// Create new day
					}

					conn.end();
				})
				.catch(err => {
					res.send(err);
				});
		}).catch(err => { 
			res.send(err); 
		});
     } catch (err) {
       console.log("SQL error : ", err);
     } finally {
		if (conn){
			conn.close(); 
		}
     }
}

if(testing){
	let data = await fetchData('https://karts.theamazingtom.com/api/speedway/GetSessionData');
	console.log(data);
}

while(true && !testing){
	setTimeout(() => {
		let res = await fetchData('https://karts.theamazingtom.com/api/speedway/GetSessionData');

		if(currentSessionData.Time != res.Time){
			previousSessionData = currentSessionData;
			populateDatabase(previousSessionData);
		}

		currentSessionData = res;
	}, pollingRate);	
}


// Async does not work
// Need to get current URL
// If current URL != last URL process the previous URL to the database