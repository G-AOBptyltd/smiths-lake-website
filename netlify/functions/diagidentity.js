// TEMP diagnostic — delete after use. Checks whether an UNAUTHENTICATED
// function invocation can reach the Netlify Identity admin token.
export const handler = async (event, context) => {
  const id = context && context.clientContext && context.clientContext.identity;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hasContext: !!context,
      hasClientContext: !!(context && context.clientContext),
      hasIdentity: !!id,
      hasToken: !!(id && id.token),
      url: (id && id.url) || null,
    }),
  };
};
