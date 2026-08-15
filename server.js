const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const triageRouter = require("./routes/triage");
app.use("/api/triage", triageRouter);

console.log("RUNNING FROM: server.js");

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000/triage.html");
});