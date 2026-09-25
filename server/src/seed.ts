/**
 * CLI helper for provisioning a business directly against the database,
 * without needing the HTTP server running. Usage:
 *
 *   npm run seed -- --name "Acme Corp" --webhook https://acme.example.com/vtbl-webhook
 *
 * Prints the plaintext API key once - it is not recoverable afterwards.
 */
import { prisma } from "./db";
import { generateApiKey, hashApiKey } from "./services/apiKey";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const name = argValue("--name");
  const webhookUrl = argValue("--webhook");

  if (!name) {
    console.error('Usage: npm run seed -- --name "Business Name" [--webhook https://...]');
    process.exit(1);
  }

  const apiKey = generateApiKey();
  const business = await prisma.business.create({
    data: { name, apiKeyHash: hashApiKey(apiKey), webhookUrl: webhookUrl ?? null },
  });

  console.log("Business created:");
  console.log(`  id:        ${business.id}`);
  console.log(`  name:      ${business.name}`);
  console.log(`  webhook:   ${business.webhookUrl ?? "(none)"}`);
  console.log(`  API key:   ${apiKey}`);
  console.log("\nStore this API key now - VTBL cannot show it again.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
