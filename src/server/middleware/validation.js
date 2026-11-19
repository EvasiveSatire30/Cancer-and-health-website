import { z } from 'zod';

export class ValidationError extends Error {
    constructor(errors, message = 'Validation failed') {
        super(message);
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

export function validate(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            return next();
        } catch (err) {
            if (err instanceof z.ZodError) {
                const errors = err.errors.reduce((acc, e) => {
                    const path = e.path.join('.');
                    acc[path] = e.message;
                    return acc;
                }, {});
                return res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    message: 'Validation failed',
                    errors,
                });
            }
            return next(err);
        }
    };
}

export default { validate, ValidationError };