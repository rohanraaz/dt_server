const express = require('express');
const cors = require('cors');
const asyncHandler = require('express-async-handler');
const axios = require('axios');

let nodeIPs = {
    0: "192.168.25.110:3000",   // ccd087
    1: "192.168.25.111:3000",   // ccd088
    2: "192.168.25.112:3000",   // ccd089
    3: "192.168.25.113:3000",   // ccd090
    4: "192.168.25.121:3000",   // ccd098
    5: "192.168.25.122:3000",   // ccd099
    6: "192.168.25.123:3000",   // ccd100
};           // dictionary to store the IP addresses of all the nodes
let primaryNode = 0;        // primary node
let currentView = 0;        // current view number

const myID = process.argv[2];             // ID of the current node

const isByzantine = process.argv[3] || false;      // boolean to check if the node is byzantine or not


let logs = [];              // list for storing logs

let cache = {};            // dictionary for storing cache

let f = 1;                // max number of faulty nodes


let becomePrimary = {};

function addTobecomePrimary(server, history) {
    if (becomePrimary[server] != undefined) {
        return false;
    }

    becomePrimary[server] = history;

    if (Object.keys(becomePrimary).length >= 2 * f + 1) {
        // console.log("adding to become primary with length " + Object.keys(becomePrimary).length)
        return true;
    }

    return false;
}

let hatered = {};          // dictionary for storing hatered

function addToHatred(server, view) {
    hatered[server] = view;

    if (Object.keys(hatered).length >= f + 1) {
        // console.log("returning true with lenth " + Object.keys(hatered).length)
        return true;
    }
    return false;
}

function cleardata(dic) {
    Object.keys(dic).forEach(key => {
        delete dic[key];
    });
}


let messageData = {};       // dictionary for storing final data
let maxN = 0;               // variable to store the maximum value of N


function printingData() {
    new_dict = {}
    for (key in messageData) {
        if (messageData[key] != null) {
            new_dict[key] = messageData[key]
        }
    }
    console.log(new_dict)
}

const receiveMessage = async (req, res) => {
    const message = req.body;

    logs.push(message);

    // if message has a field view and not matching
    if (message.type != "NEW_VIEW" && message.type != "REQUEST" && message.view != currentView) {
        // console.log(message)
        // console.log(message.view)
        // console.log(message.view + " " + currentView)
        // console.log("some other view ")
        // console.log(message)
        res.json("ignored")
    }
    else {

        if (myID == primaryNode) {
            if (message.type == "REQUEST") {
                console.log("primary, got request for ", message.message)

                // if the client sent the same request again, then send the cached response
                if (cache[message.clientID] != undefined && cache[message.clientID].timestamp == message.timestamp) {
                    // ignore this, after timeout the client will send the request to all replicas and they reply from their cache
                }

                const n = maxN + 1;
                maxN = n;
                // send order req to all nodes, collect their responses and forward to client
                const ORDER_REQ = {
                    type: "ORDER_REQ",
                    view: currentView,
                    seq: n,
                    history: messageData,
                    message: message.message,
                    m: message
                }

                if (isByzantine) {
                    const url = `http://${nodeIPs[myID]}/request`
                    // console.log(url);

                    try {
                        const response = await axios.post(url, ORDER_REQ);
                    }
                    catch (error) {
                        console.log("Error in sending order req to node ", myID);
                        // console.log(error);
                    }

                    for (let key in nodeIPs) {
                        if (key != myID) {
                            const url = `http://${nodeIPs[key]}/request`
                            // console.log(url);
                            try {
                                const response = await axios.post(url, ORDER_REQ);
                            } catch (error) {
                                console.log("Error in sending order req to node ", key);
                                // console.log(error);
                            }
                            break;
                        }
                    }
                }
                else {
                    for (let key in nodeIPs) {
                        const url = `http://${nodeIPs[key]}/request`
                        // console.log(url);
                        try {
                            const response = await axios.post(url, ORDER_REQ);
                        } catch (error) {
                            console.log("Error in sending order req to node ", key);
                            // console.log(error);
                        }
                    }
                }

                console.log("Order request sent to all nodes!");

                // res.status(200).json({ message: "Order request sent to all nodes!" });

                res.status(200).json({
                    seq: n
                });
            }
            else if (message.type == "ORDER_REQ") {
                console.log("primary, got order req");
                // send spec response to client
                // spec response in our case is just the message data(number) itself
                const reqBody = req.body;
                const data = reqBody.message;



                messageData[reqBody.seq] = data;

                const SpecResponse = {
                    type: "SPEC_RESPONSE",
                    view: currentView,
                    seq: message.seq,
                    history: messageData,
                    client: message.m.clientID,
                    timestamp: message.m.timestamp,
                    server: nodeIPs[myID],
                    reply: data,
                    OR: reqBody
                }

                cache[SpecResponse.client] = SpecResponse;

                const clientURL = `http://${reqBody.m.client}/specresponse`;
                const response = await axios.post(clientURL, SpecResponse);
                console.log("sent spec response to " + reqBody.m.client)

                // console.log(response.data);

                res.status(200).json("Response sent to client!");
            }
            else if (message.type == "FILL_HOLE") {
                // send messageData to the node
            }
            else if (message.type == "COMMIT_CERTIFICATE") {
                // make sure that your history matches with the history given in cc
                // <implement the above functionality>

                console.log("primary, got commit certificate");
                // console.log(message)
                // console.log(message.seq)
                if (message.last_message != messageData[message.seq]) {
                    // initiate a view change as there is a mismatch

                    // !!!!!!!!!!!!<------ code here ---------->!!!!!!!!!!

                    messageData[message.seq] = message.last_message;
                }

                const localCommit = {
                    type: "LOCAL_COMMIT",
                    view: currentView,
                    history: messageData,
                    server: nodeIPs[myID],
                    client: message.client
                }

                res.status(200).json({ localCommit })
            }
            else if (message.type == "MIS_MATCH") {
                console.log(myID + " got mismatch");
                res.json({ message: "initiating View change" });
                // initiate view change
                if (!isByzantine) {
                    const hate_message = {
                        type: "I_HATE_PRIMARY",
                        view: currentView,
                        server: nodeIPs[myID]
                    }

                    const mismatchSeq = message.seq;
                    messageData[mismatchSeq] = null;

                    for (let key in nodeIPs) {
                        const url = `http://${nodeIPs[key]}/request`
                        const body = hate_message;
                        try {
                            // console.log(myID + " sending hate message to ", key)
                            const response = await axios.post(url, body);
                        }
                        catch (error) {
                            console.log("Error in sending hate message to node ", key);
                        }
                    }
                }
            }
            else if (message.type == "I_HATE_PRIMARY") {
                console.log("primary, got hate message from ", message.server);
                res.json("received hate message");
                if (!isByzantine) {
                    let newView = currentView + 1;
                    newView = newView % (3 * f + 1);
                    // initiate view change
                    if (addToHatred(message.server, message.view)) {
                        const viewChange = {
                            type: "VIEW_CHANGE",
                            view: currentView,
                            newview: newView,
                            server: nodeIPs[myID],
                            history: messageData
                        }

                        for (let key in nodeIPs) {
                            const url = `http://${nodeIPs[key]}/request`
                            const body = viewChange;
                            try {
                                const response = await axios.post(url, body);
                                // console.log(myID + " sent view_change to " + key + " for " + newView)
                            }
                            catch (error) {
                                console.log("Error in sending hate message to node ", key);
                            }
                        }
                    }
                }
                // <implement the above functionality>
            }
            else if (message.type == "VIEW_CHANGE") {
                console.log(myID + " got view change for " + message.newview);
                if (myID == message.newview) {
                    if (addTobecomePrimary(message.server, message.history)) {
                        const newView = {
                            type: "NEW_VIEW",
                            view: message.newview
                        }

                        for (let key in nodeIPs) {
                            const url = `http://${nodeIPs[key]}/request`
                            const body = newView;
                            try {
                                const response = await axios.post(url, body);
                                // console.log(myID + " sent view_change to " + key + " for " + message.newview)
                            }
                            catch (error) {
                                console.log("Error in sending hate message to node ", key);
                            }
                        }
                    }
                    res.send("I am the new primary");
                }
                else {
                    res.send("I am a replica");
                }
            }
            else if (message.type == "NEW_VIEW") {
                console.log("primary, got new view");
                printingData();

                cleardata(cache)
                cleardata(messageData)
                cleardata(becomePrimary)
                cleardata(hatered)

                maxN = 0;

                primaryNode = message.view;
                currentView = message.view;
                console.log("view changed to " + currentView)
                res.json("view changed");
            }
        }
        else {
            if (message.type == "REQUEST") {
                // forward message to primary node

                const url = `http://${nodeIPs[primaryNode]}/request`;
                const response = await axios.post(url, message);

                console.log(response.data);

                console.log("replica, got REQUEST");
                res.status(200).json(response.data);
            }
            else if (message.type == "ORDER_REQ") {
                console.log("replica, got order req")
                // send spec response to client
                // spec response in our case is just the message data(number) itself
                const reqBody = req.body;
                const data = reqBody.message;

                messageData[reqBody.seq] = data;

                // console.log(reqBody);

                const SpecResponse = {
                    type: "SPEC_RESPONSE",
                    view: currentView,
                    seq: message.seq,
                    history: messageData,
                    client: message.m.clientID,
                    timestamp: message.m.timestamp,
                    server: nodeIPs[myID],
                    reply: data,
                    OR: reqBody
                }

                cache[SpecResponse.client] = SpecResponse;

                const clientURL = `http://${reqBody.m.client}/specresponse`;
                const response = await axios.post(clientURL, SpecResponse);
                console.log("sent spec response to " + reqBody.m.client)

                // console.log(response.data);

                res.status(200).json("Response sent to client!");
            }
            else if (message.type == "COMMIT_CERTIFICATE") {
                console.log("replica, got commit certificate");
                // make sure that your history matches with the history given in cc
                // <implement the above functionality
                // console.log(message)
                if (message.last_message != messageData[message.seq]) {
                    // initiate a view change as there is a mismatch

                    // !!!!!!!!!!!!<------ code here ---------->!!!!!!!!!!

                    messageData[message.seq] = message.last_message;
                }

                const localCommit = {
                    type: "LOCAL_COMMIT",
                    view: currentView,
                    history: messageData,
                    server: nodeIPs[myID],
                    client: message.client
                }

                res.status(200).json({ localCommit })
            }
            else if (message.type == "MIS_MATCH") {
                console.log(myID + " got mismatch");
                res.json({ message: "initiating View change" });
                // initiate view change
                if (!isByzantine) {
                    const hate_message = {
                        type: "I_HATE_PRIMARY",
                        view: currentView,
                        server: nodeIPs[myID]
                    }

                    const mismatchSeq = message.seq;
                    messageData[mismatchSeq] = null;

                    for (let key in nodeIPs) {
                        const url = `http://${nodeIPs[key]}/request`
                        const body = hate_message;
                        try {
                            // console.log(myID + " sending hate message to ", key)
                            const response = await axios.post(url, body);
                        }
                        catch (error) {
                            console.log("Error in sending hate message to node ", key);
                        }
                    }
                }
            }
            else if (message.type == "I_HATE_PRIMARY") {
                console.log("replica, got hate message from ", message.server);
                res.json("received hate message");

                if (!isByzantine) {
                    let newView = currentView + 1;
                    newView = newView % (3 * f + 1);
                    // initiate view change
                    if (addToHatred(message.server, message.view)) {
                        const viewChange = {
                            type: "VIEW_CHANGE",
                            view: currentView,
                            newview: newView,
                            server: nodeIPs[myID],
                            history: messageData
                        }

                        for (let key in nodeIPs) {
                            const url = `http://${nodeIPs[key]}/request`
                            const body = viewChange;
                            try {
                                const response = await axios.post(url, body);
                                // console.log(myID + " sent view_change to " + key + " for " + newView)
                            }
                            catch (error) {
                                console.log("Error in sending hate message to node ", key);
                            }
                        }
                    }
                }
                // <implement the above functionality>
            }
            else if (message.type == "VIEW_CHANGE") {
                console.log(myID + " got view change for " + message.newview);
                if (myID == message.newview) {
                    if (addTobecomePrimary(message.server, message.history)) {
                        const newView = {
                            type: "NEW_VIEW",
                            view: message.newview
                        }

                        for (let key in nodeIPs) {
                            const url = `http://${nodeIPs[key]}/request`
                            const body = newView;
                            try {
                                const response = await axios.post(url, body);
                                // console.log(myID + " sent view_change to " + key + " for " + message.newview)
                            }
                            catch (error) {
                                console.log("Error in sending hate message to node ", key);
                            }
                        }
                    }
                    res.send("I am the new primary");
                }
                else {
                    res.send("I am a replica");
                }
            }
            else if (message.type == "NEW_VIEW") {
                console.log("primary, got new view");
                printingData();

                cleardata(cache)
                cleardata(messageData)
                cleardata(becomePrimary)
                cleardata(hatered)

                maxN = 0;

                primaryNode = message.view;
                currentView = message.view;
                console.log("view changed to " + currentView)
                res.json("view changed");
            }
        }
    }

    // res.status(200).json({ message: "Message received!" });
};

const getData = (req, res) => {
    res.status(200).json({ messageData });
}

const getlogs = (req, res) => {
    res.status(200).json({ logs })
}



const app = express();
app.use(cors());
app.use(express.json());

const port = 3000;

app.listen(port, () => {
    console.log(`App running on port ${port}.`);
});

app.post("/request", asyncHandler(receiveMessage));

app.get("/testing/getData", asyncHandler(getData));
app.get("/testing/hello", (req, res) => {
    console.log("got a hello request");
    res.status(200).send("hello");
})
app.get("/testing/getlogs", asyncHandler(getlogs));