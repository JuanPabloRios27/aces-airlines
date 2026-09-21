const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el port 3000.`);
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

app.use((req, res, next) => {
    res.status(404);
    res.send('Service finished, please contact with the administrator!');
});