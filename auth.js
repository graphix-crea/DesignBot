// api/auth.js
// Gestion de l'authentification - login / register / logout / session

const crypto = require('crypto');

// --- Stockage en mémoire (remplacé par Vercel KV en prod si besoin) ---
// Pour Vercel serverless, on utilise un store global simple.
// En production avec beaucoup d'utilisateurs, migrer vers Vercel KV ou PlanetScale.

if (!global._users) {
  global._users = {
    // Compte admin par défaut — CHANGE LE MOT DE PASSE avant de déployer !
    admin: {
      username: 'admin',
      passwordHash: hashPassword('admin1234'),
      role: 'admin',
      profile: {
        level: 'expert',
        style: 'minimaliste',
        speciality: 'direction artistique',
        lang: 'fr'
      },
      createdAt: new Date().toISOString()
    }
  };
}

if (!global._sessions) {
  global._sessions = {};
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'designbot_salt_2024').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of Object.entries(global._sessions)) {
    if (session.expiresAt < now) delete global._sessions[token];
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const body = req.body || {};

  cleanExpiredSessions();

  // ── LOGIN ──
  if (action === 'login') {
    const { username, password } = body;
    if (!username || !password)
      return res.status(400).json({ error: 'Identifiants manquants' });

    const user = global._users[username.toLowerCase()];
    if (!user || user.passwordHash !== hashPassword(password))
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });

    const token = generateToken();
    global._sessions[token] = {
      username: user.username,
      role: user.role,
      profile: user.profile,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 jours
    };

    return res.status(200).json({
      success: true,
      token,
      username: user.username,
      role: user.role,
      profile: user.profile
    });
  }

  // ── REGISTER ──
  if (action === 'register') {
    const { username, password, inviteCode } = body;

    // Code d'invitation pour contrôler les inscriptions
    const validCode = process.env.INVITE_CODE || 'DESIGN2024';
    if (inviteCode !== validCode)
      return res.status(403).json({ error: 'Code d\'invitation invalide' });

    if (!username || !password)
      return res.status(400).json({ error: 'Données manquantes' });

    if (username.length < 3 || password.length < 6)
      return res.status(400).json({ error: 'Username 3+ chars, mot de passe 6+ chars' });

    const key = username.toLowerCase();
    if (global._users[key])
      return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris' });

    global._users[key] = {
      username,
      passwordHash: hashPassword(password),
      role: 'user',
      profile: { level: '', style: '', speciality: '', lang: 'fr' },
      createdAt: new Date().toISOString()
    };

    const token = generateToken();
    global._sessions[token] = {
      username,
      role: 'user',
      profile: global._users[key].profile,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    };

    return res.status(200).json({ success: true, token, username, role: 'user', profile: global._users[key].profile });
  }

  // ── VERIFY SESSION ──
  if (action === 'verify') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = global._sessions[token];
    if (!session || session.expiresAt < Date.now())
      return res.status(401).json({ error: 'Session expirée' });

    return res.status(200).json({ success: true, username: session.username, role: session.role, profile: session.profile });
  }

  // ── UPDATE PROFILE ──
  if (action === 'profile') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = global._sessions[token];
    if (!session) return res.status(401).json({ error: 'Non authentifié' });

    const { profile } = body;
    const user = global._users[session.username.toLowerCase()];
    if (user && profile) {
      user.profile = { ...user.profile, ...profile };
      session.profile = user.profile;
    }
    return res.status(200).json({ success: true, profile: user?.profile });
  }

  // ── LOGOUT ──
  if (action === 'logout') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) delete global._sessions[token];
    return res.status(200).json({ success: true });
  }

  return res.status(404).json({ error: 'Action inconnue' });
};
