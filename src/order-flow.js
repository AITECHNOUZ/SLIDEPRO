function requiresStudentDetails({ isAdmin = false, isVip = false } = {}) {
  return !isAdmin && !isVip;
}

module.exports = { requiresStudentDetails };
