const jwt = require('jsonwebtoken');
const { User, Role } = require('../models');

exports.authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(payload.sub, {
      include: [{ model: Role, as: 'role' }],
    });
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Invalid or inactive user' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

exports.requireAdmin = (req, res, next) => {
  const roleName = req.user?.role?.name || '';
  if (!['Admin', 'SuperAdmin'].includes(roleName)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

exports.signTokens = (user) => {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, role: user.role?.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '24h' },
  );
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' },
  );
  return { accessToken, refreshToken };
};
