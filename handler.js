/* This is where the functions live that the functions section of the YAML 
file points to. These functions get added to Lambda, where they'll run in 
their own containers (kind of like Docker) when they receive a request to 
the path/method specified in the YAML.
Just to note, it's better practice to have each function in a separate file, 
so I'd refactor this accordingly. For simplicity's sake now though, they're 
all in this one file. */

//--------------------------------------------------------------------------

"use strict"; //enables strict mode, which makes things that normally cause
//warnings error out (keeps the code cleaner)
const AWS = require("aws-sdk"); //requires AWS CLI that you set up with your credentials earlier
const db = new AWS.DynamoDB.DocumentClient({ apiVersion: "2019.11.21" }); //creates a
//new instance of DynamoDB when called using the AWS SDK
const { v4: uuidv4 } = require("uuid"); //auto-generates unique ids

const dictionaryTable = process.env.DYNAMODB_TABLE; //gets the table from the environment
//variables (which we've set up in the YAML) and saves it to a variable we can
//use in the functions below
//(for this example, we have a table that acts like a dictionary, saving words
//and their definitions)

//---------HELPER FUNCTION TO SEND RESPONSE JSONS WITH HEADERS:---------

//This saves you from having to do these bits to process the response in each function
function response(statusCode, message) {
  //takes in the status code and a message (an object) from the response
  return {
    statusCode: statusCode,
    //gives us back the status code it's received
    headers: {
      //sticks all the right headers on to talk to the request during the
      //preflight check (CORS)
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
      "Access-Control-Allow-Methods": "GET, OPTIONS, POST, PUT, DELETE",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message), //stringifies the body object into JSON
  };
}

//---------GET ALL ITEMS IN THE TABLE:---------

module.exports.getAllItems = (event, context, callback) => {
  /* all lambda functions take in event (the request) along with context 
  and callback (which then lets you use that response helper function above) */

  return (
    db //creates an instance of DynamoDB
      .scan({
        //scan is DynamoDB-speak for getting all the items
        /* NOTE: Be aware that when you have a larger-scale database, scan 
        becomes very expensive as it reads everything in your table, and you're 
        charged by how much you read (remember the throughput section in the 
        YAML with the ReadCapacityUnits you've set - you'll burn through these 
        quickly if your table's big). For a small table like what you're setting 
        up today, though, It's fine. It's just something to be aware of for the 
        future. */
        TableName: dictionaryTable, //which table to scan
      })
      .promise()
      .then((res) => callback(null, response(200, res.Items))) //status code 200 for success
      //message becomes JSON with all of the items in the table
      .catch((err) => callback(null, response(err.statusCode, err))) //error handling
    //gets the status code from the error and the error itself as the message
  );
};

//---------GET A SINGLE ITEM BY ID:---------

module.exports.getItemById = (event, context, callback) => {
  const id = event.pathParameters.id; //gets the id out of the parameters of
  //the event aka the request (the DynamoDB equivalent of doing req.params)

  const params = {
    //separate params object to tell the db which table and to use the id as
    //the key (which will work because we set up the id in the YAML to be the
    //partition key)
    Key: {
      id: id,
    },
    TableName: dictionaryTable,
  };

  return (
    db
      .get(params) //passes the params object to get method to use it to look for
      //the id in the table
      .promise()
      .then((res) => {
        if (res.Item) callback(null, response(200, res.Item));
        //checks if there's an item with that id; if so, it's in res.Item
        else
          callback(
            null,
            response(404, { error: "No item with that name found" })
          ); //if it doesn't find anything w/ that id, 404 error instead
      })
      .catch((err) => callback(null, response(err.statusCode, err)))
  );
};

//---------POST NEW ITEM:---------

module.exports.addItem = (event, context, callback) => {
  /*   I've set up the example item below as a dictionary entry with a name 
key and a definition key; you can have as many as you want (just like a 
  standard JSON); you just have to tell it what to expect below. Example JSON
   in request: {"name": "petrichor", "definition": "the smell after rain"} */

  const reqBody = JSON.parse(event.body); //parses the whole body out of
  //the event (the request) and saves it to a variable

  const item = {
    //creates the item that will then be added to the database, incl the bits
    //from the request body
    id: uuidv4(), //uses uuid to autogenerate a new unique id for the item
    createdAt: new Date().toISOString(), //automatically adds a human-readable date
    name: reqBody.name, //destructures the name string out of the request body
    //and saves it to the name key for the database
    definition: reqBody.definition, //destructures the definition string out
    //of the request body and saves it to the definition key for the database
  };

  return db
    .put({
      /* //passes the table name and the item we just created above to the put
      NOTE: even though it's creating a new item and is set up in the YAML 
      to respond to post requests, you still use put here when it's talking 
      directly to DynamoDB (it puts a new item rather than putting a 
        replacement here) */
      TableName: dictionaryTable,
      Item: item,
    })
    .promise()
    .then(() => {
      callback(null, response(200, item));
    })
    .catch((err) => response(null, response(err.statusCode, err)));
};

//---------UPDATE ITEM (PUT REQUEST):---------

module.exports.updateItem = (event, context, callback) => {
  const id = event.pathParameters.id; //gets the id out of the path params
  //just like in the get by id function above
  const reqBody = JSON.parse(event.body); //parses the body just like with
  //the addItem post function above

  const item = {
    //similar to addItem above, this uses the body, but we already have the
    //id from the params, so we use it and don't generate a new one with uuid
    id: id, //it'll use the id to match the item since it's the partition
    //key (DynamoDB equivalent of primary key)
    createdAt: new Date().toISOString(), //replaces the initial createdAt date
    name: reqBody.name,
    definition: reqBody.definition,
  };

  return db
    .put({
      //just like in the post function above (still a put, but this time
      //we're doing a put request like we're used to, making a direct
      //replacement of the item)
      TableName: dictionaryTable,
      Item: item,
    })
    .promise()
    .then((res) => {
      callback(null, response(200, res));
    })
    .catch((err) => callback(null, response(err.statusCode, err)));
};

//---------DELETE ITEM:---------

module.exports.deleteItem = (event, context, callback) => {
  const id = event.pathParameters.id;

  const params = {
    //same params object as with the get by id function
    Key: {
      id: id,
    },
    TableName: dictionaryTable,
  };

  return (
    db
      .delete(params) //params are passed to delete so that it can do what it
      //says on the tin for the relevant item
      .promise()
      .then(() =>
        callback(null, response(200, { message: `${id} deleted successfully` }))
      )
      .catch((err) => callback(null, response(err.statusCode, err)))
  );
};
