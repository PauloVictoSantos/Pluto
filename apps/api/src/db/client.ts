import { MongoClient, type Db } from 'mongodb';

export interface Database {
  client: MongoClient;
  db: Db;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export async function connectDatabase(uri: string): Promise<Database> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5_000,
    appName: 'pluto-api',
  });
  await client.connect();
  const db = client.db();

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
