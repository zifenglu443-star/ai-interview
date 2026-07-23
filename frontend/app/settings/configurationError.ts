export type ApiErrorPayload = {
  detail?: string | Array<{ msg?: string }>;
};

export function getApiErrorMessage(payload: ApiErrorPayload | null) {
  if (!payload?.detail) return "Configuration could not be saved.";
  if (typeof payload.detail === "string") return payload.detail;
  const messages = payload.detail
    .map((item) => item.msg)
    .filter((message): message is string => Boolean(message));
  return messages.length > 0
    ? messages.join(" ")
    : "Configuration could not be saved.";
}
