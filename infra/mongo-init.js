// Executado uma unica vez na criacao do volume. Cria o usuario de minimo privilegio.
const appDb = db.getSiblingDB('pluto');
appDb.createUser({
  user: process.env.PLUTO_APP_USER,
  pwd: process.env.PLUTO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'pluto' }],
});
