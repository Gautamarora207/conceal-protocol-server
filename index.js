const Deposit = require("./lib/deposit.js");
const express = require('express');
const app = express();

var cors = require('cors')


let port = process.env.PORT || 8080;

app.use(express.json());
app.use(cors());

app.post('/api/getProof',async (req, res) =>  {
    try {
        const { note, recipient } = req.body;
        console.log(req.body);

        const response = await Deposit.parseNote(note, recipient);
        console.log(response);
        res.json({ type: 'success', response });
        
    } catch(e){
        return res.status(400).json({ type: 'error', message: e.message });
    }   
});


app.listen(port, () => {
    console.log(`listening at localhost:${port}`);
});
