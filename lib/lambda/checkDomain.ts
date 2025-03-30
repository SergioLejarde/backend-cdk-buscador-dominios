import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { Client } from "pg";

export const handler = async (event: any) => {
  const secretName = process.env.SECRET_NAME; // <-- Reemplaza esto por el nombre real de tu secreto
  const client = new SecretsManagerClient({ region: "us-east-1" });

  const secret = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  const credentials = JSON.parse(secret.SecretString!);

  const db = new Client({
    host: credentials.host,
    port: credentials.port,
    user: credentials.username,
    password: credentials.password,
    database: credentials.dbname,
    ssl: true,
  });

  await db.connect();

  const domain = event.queryStringParameters?.domain;

  if (!domain) {
    return { statusCode: 400, body: "Missing domain parameter." };
  }

  const result = await db.query(
    "SELECT * FROM malicious_domains WHERE domain = $1",
    [domain]
  );

  await db.end();

  if (result.rows.length > 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        domain,
        malicious: true,
        threat_level: result.rows[0].threat_level,
        detected_at: result.rows[0].detected_at,
      }),
    };
  } else {
    return {
      statusCode: 200,
      body: JSON.stringify({ domain, malicious: false }),
    };
  }
};
