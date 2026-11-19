import logger from '../config/logger.js';

export class ApiError extends Error {
    constructor(statusCode, message, code = 'ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = 'ApiError';
    }
}

export const notFound = (req, res) => {
    res.status(404).json({ error: 'Not Found', message: 'The requested resource was not found.' });
};

export const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
    let status = err.statusCode || err.status || 500;
    let message = err.message || 'Internal Server Error';
    let code = err.code || 'INTERNAL_ERROR';

    // Validation errors
    if (err.name === 'ZodError') {
        status = 400;
        code = 'VALIDATION_ERROR';
        const errors = Object.entries(err.errors || {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
        message = `Validation error: ${errors}`;
    }

    // Don't leak error details in production
    if (status === 500 && process.env.NODE_ENV === 'production') {
        message = 'Internal Server Error';
    }

    logger.error({ err, req: { method: req.method, path: req.path } }, 'Request failed');

    if (res.headersSent) {
        return next(err);
    }

    res.status(status).json({
        error: code,
        message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    });
};

export default { ApiError, notFound, errorHandler };