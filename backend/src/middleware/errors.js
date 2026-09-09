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
    response.status(error.statusCode ?? 500).json({
        error: {
            code: error.code ?? 'INTERNAL_ERROR',
            message: error.statusCode ? error.message : 'An unexpected error occurred',
        },
    });
}
