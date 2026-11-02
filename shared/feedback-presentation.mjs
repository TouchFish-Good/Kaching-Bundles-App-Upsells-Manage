const labels = {
  pending: { label: '待审核', tone: 'muted' },
  approved: { label: '已批准', tone: 'success' },
  in_progress: { label: '开发中', tone: 'info' },
  released: { label: '已上线', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'danger' },
  rejected_hidden: { label: '拒绝显示', tone: 'danger' },
  withdrawn: { label: '已撤回', tone: 'muted' },
};

export function displayStatus(feedback) {
  return labels[feedback.displayStatus] ?? labels[feedback.status] ?? labels.pending;
}

export function canChangeStatus(feedback) {
  return feedback.displayStatus !== 'withdrawn';
}
