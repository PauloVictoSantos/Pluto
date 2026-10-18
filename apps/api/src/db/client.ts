import { MongoClient, type Db } from 'mongodb';

export interface Database {
  client: MongoClient;
  db: Db;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** O banco vem de MONGODB_DB, nao da URI: sem /pluto na URI o driver usaria "test" e gravaria num banco vazio. */
export async function connectDatabase(uri: string, dbName: string): Promise<Database> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5_000,
    appName: 'pluto-api',
  });
  await client.connect();
  const db = client.db(dbName);

  return {
    client,
    db,
    async ping() {
      try {
        await db.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}
