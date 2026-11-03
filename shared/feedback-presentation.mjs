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

export const commentManagementHeaders = ['评论', '商家', '是否匿名', '状态', '创建时间', '所属建议', '操作'];

export function commentSourceLabel(comment) {
  return comment.feedbackTitle;
}

export function commentFiltersPath({ query, store, from, to, offset = '0' }) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (store) params.set('store', store);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('limit', '25');
  params.set('offset', offset);
  return `/feedback-comments?${params}`;
}
