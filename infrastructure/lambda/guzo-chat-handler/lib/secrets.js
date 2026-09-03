let cachedKey = null;

/**
 * Resolve OpenRouter API key.
 * Prefer OPENROUTER_API_KEY env (local/dev); else Secrets Manager via OPENROUTER_SECRET_ARN.
 */
export async function getOpenRouterApiKey() {
    if (cachedKey) return cachedKey;

    const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
    if (fromEnv && fromEnv !== 'REPLACE_ME') {
        cachedKey = fromEnv;
        return cachedKey;
    }

    const arn = process.env.OPENROUTER_SECRET_ARN;
    if (!arn) {
        throw new Error('Set OPENROUTER_API_KEY or OPENROUTER_SECRET_ARN');
    }

    const { SecretsManagerClient, GetSecretValueCommand } = await import(
        '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({});
    const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const parsed = JSON.parse(SecretString || '{}');
    const key = parsed.OPENROUTER_API_KEY;

    if (!key || key === 'REPLACE_ME') {
        throw new Error('OpenRouter API key not configured in Secrets Manager');
    }

    cachedKey = key;
    return key;
}
