// Shared helpers for parsing Claude responses.
//
// The grading/AI functions all ask Claude for JSON and then defensively extract
// it (models sometimes wrap JSON in prose or ```json fences). This 3-tier
// parser was copy-pasted identically across six functions; it now lives here.
//
// Behaviour is intentionally identical to the previous inline version:
//   1. try to parse the whole string as JSON
//   2. else extract the first ```json ... ``` fenced block
//   3. else slice from the first "{" to the last "}"
//   4. else throw

function parseJsonResponse(content, errorLabel = 'response') {
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      return JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    }
    throw new Error(`Could not parse ${errorLabel} JSON`);
  }
}

// Extract the text from a Claude Messages API response, and surface a clear
// error when the model hit the token cap mid-JSON (which otherwise fails as an
// opaque parse error). Returns the text content string.
function getResponseText(response) {
  if (response && response.stop_reason === 'max_tokens') {
    throw new Error('Claude response was truncated (max_tokens reached) before valid JSON could be produced');
  }
  return response.content[0].text;
}

module.exports = { parseJsonResponse, getResponseText };
