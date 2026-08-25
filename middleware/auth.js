const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  let token;

  // Check Authorization header or query parameter (useful for SSE streams if headers are hard to send)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access denied. Authorization token missing.' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'chatnest_default_jwt_secret_key_2026';
    const decoded = jwt.verify(token, secret);
    req.user = decoded; // Contains id, email, name
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token. Please log in again.' });
  }
};

module.exports = authMiddleware;
