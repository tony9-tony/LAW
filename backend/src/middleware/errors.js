export function notFoundHandler(_request, response) {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
}

export function errorHandler(error, _request, response, _next) {
    console.error(error.message);
    if (error.name === 'ZodError') {
        return response.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'Request input is invalid' },
        });
    }
    /* Body-parser rejects oversized JSON payloads with the generic message
       "request entity too large"; report it as an upload problem instead so
       the UI does not show a misleading internal error. */
    if (error.type === 'entity.too.large') {
        return response.status(413).json({
            error: { code: 'PAYLOAD_TOO_LARGE', message: 'Uploaded file is too large' },
        });
    }
    response.status(error.statusCode ?? 500).json({
        error: {
            code: error.code ?? 'INTERNAL_ERROR',
            message: error.statusCode ? error.message : 'An unexpected error occurred',
        },
    });
}
