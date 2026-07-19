const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_ADDRESS_LOOSE_RE = /^0x[a-fA-F0-9]{8,64}$/i;
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function detectContractAddress(text) {
  const trimmed = text.trim();
  if (EVM_ADDRESS_RE.test(trimmed) || EVM_ADDRESS_LOOSE_RE.test(trimmed)) {
    return trimmed;
  }
  if (SOL_ADDRESS_RE.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function buildFilterReplyPayload(responses) {
  const lines = [];
  const copyButtons = [];

  for (const response of responses) {
    const address = detectContractAddress(response);
    if (address) {
      lines.push(`<code>${escapeHtml(address)}</code>`);
      copyButtons.push([
        {
          text: copyButtons.length === 0 ? "Copy CA" : `Copy CA ${copyButtons.length + 1}`,
          copy_text: { text: address },
        },
      ]);
    } else {
      lines.push(escapeHtml(response));
    }
  }

  const payload = {
    text: lines.join("\n\n"),
    parse_mode: "HTML",
  };

  if (copyButtons.length > 0) {
    payload.reply_markup = { inline_keyboard: copyButtons };
  }

  return payload;
}
