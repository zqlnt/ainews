// No model text or fabricated analysis is returned on provider failure.
export function researchFailure(code) {
  return {success: false, schema_version: '2.1', status: 'unavailable',
    error: {code, retryable: true},
    message: 'Traid Research could not complete this request. Your local calculations remain available.',
    analysis: '', analysis_v2: null};
}
