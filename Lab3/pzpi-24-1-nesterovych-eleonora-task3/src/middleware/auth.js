'use strict';

const jwt = require('jsonwebtoken');
const { HttpError, asyncHandler } = require('./errors');

// Створює middleware для автентифікації (JWT) та перевірки ролей.
function createAuth(models, config) {
  const authenticate = asyncHandler(async (req, res, next) => {
    // Очікуваний заголовок: "Authorization: Bearer <token>"
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'Authentication required');
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }

    const user = await models.User.findByPk(payload.sub);
    if (!user) {
      throw new HttpError(401, 'User no longer exists');
    }
    if (user.isBlocked) {
      throw new HttpError(403, 'Account is blocked');
    }

    req.user = user;
    next();
  });

  const requireRole = (...roles) => (req, res, next) => {
    if (roles.includes(req.user.role)) {
      return next();
    }
    return next(new HttpError(403, 'Forbidden'));
  };

  const adminOnly = [authenticate, requireRole('admin')];

  return { authenticate, requireRole, adminOnly };
}

module.exports = { createAuth };
