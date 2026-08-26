import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function createBearerAuth(token: string) {
	const expected = Buffer.from(token)

	return (req: Request, res: Response, next: NextFunction) => {
		const header = req.headers.authorization
		if (!header?.startsWith('Bearer ')) {
			res.status(401).json({ error: 'Missing or invalid Authorization header' })
			return
		}

		const provided = Buffer.from(header.slice(7))
		if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
			res.status(401).json({ error: 'Invalid token' })
			return
		}

		next()
	}
}
