/** Server-only provider configuration. No credential is returned to the client. */
export function aiProvider(env: Record<string, string | undefined> = process.env) {
  const useOpenAI =
    env["AI_PROVIDER"] === "openai" || (!env["LOVABLE_API_KEY"] && !!env["OPENAI_API_KEY"]);
  const key = useOpenAI ? env["OPENAI_API_KEY"] : env["LOVABLE_API_KEY"];
  return {
    provider: useOpenAI ? "OpenAI" : "Lovable",
    key,
    url: useOpenAI
      ? "https://api.openai.com/v1/responses"
      : "https://ai.gateway.lovable.dev/v1/responses",
    model: useOpenAI ? env["OPENAI_MODEL"] || "gpt-6-astra" : "openai/gpt-6-astra",
  };
}
