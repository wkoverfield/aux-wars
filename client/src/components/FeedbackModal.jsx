import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';

// Get or create a persistent visitor ID for upvoting
function getVisitorId() {
  let id = localStorage.getItem('aux-wars-visitor-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('aux-wars-visitor-id', id);
  }
  return id;
}

const FEEDBACK_TYPES = [
  { value: 'feature', label: 'Feature Request', color: 'bg-blue-500' },
  { value: 'bug', label: 'Bug Report', color: 'bg-red-500' },
  { value: 'improvement', label: 'Improvement', color: 'bg-yellow-500' },
  { value: 'other', label: 'Other', color: 'bg-gray-500' },
];

export default function FeedbackModal({ showModal, onClose }) {
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState('feature');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const feedback = useQuery(api.feedback.getFeedback);
  const submitFeedback = useMutation(api.feedback.submitFeedback);
  const upvoteFeedback = useMutation(api.feedback.upvoteFeedback);
  const removeUpvote = useMutation(api.feedback.removeUpvote);

  const visitorId = getVisitorId();

  // Reset form when modal closes
  useEffect(() => {
    if (!showModal) {
      setShowForm(false);
      setType('feature');
      setTitle('');
      setDescription('');
      setAuthorName('');
    }
  }, [showModal]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setIsSubmitting(true);
    try {
      await submitFeedback({
        type,
        title,
        description,
        authorName: authorName || undefined,
        visitorId,
      });
      setShowForm(false);
      setTitle('');
      setDescription('');
      setAuthorName('');
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    }
    setIsSubmitting(false);
  };

  const handleUpvote = async (feedbackId, hasVoted) => {
    try {
      if (hasVoted) {
        await removeUpvote({ feedbackId, visitorId });
      } else {
        await upvoteFeedback({ feedbackId, visitorId });
      }
    } catch (error) {
      console.error('Failed to vote:', error);
    }
  };

  const getTypeConfig = (type) => {
    return FEEDBACK_TYPES.find((t) => t.value === type) || FEEDBACK_TYPES[3];
  };

  return (
    <AnimatePresence>
      {showModal && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal content */}
          <motion.div
            className="relative w-full max-w-2xl mx-auto bg-[#1a1a1a] rounded-lg shadow-2xl flex flex-col"
            style={{ maxHeight: '85vh' }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4 border-b border-gray-700">
              <h2 className="text-2xl font-bold text-white mb-1">Suggestions & Feedback</h2>
              <p className="text-gray-400 text-sm">Help us improve Aux Wars</p>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6">
              {showForm ? (
                /* Feedback Form */
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Type selector */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Type</label>
                    <div className="flex flex-wrap gap-2">
                      {FEEDBACK_TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setType(t.value)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                            type === t.value
                              ? `${t.color} text-white`
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Title <span className="text-gray-500">({title.length}/100)</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value.slice(0, 100))}
                      placeholder="Short, descriptive title"
                      className="w-full px-4 py-2 bg-[#242424] border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-[#68d570]"
                      required
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Description <span className="text-gray-500">({description.length}/500)</span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                      placeholder="Describe your suggestion or issue in detail..."
                      rows={4}
                      className="w-full px-4 py-2 bg-[#242424] border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-[#68d570] resize-none"
                      required
                    />
                  </div>

                  {/* Name (optional) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Your Name <span className="text-gray-500">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value.slice(0, 50))}
                      placeholder="Anonymous"
                      className="w-full px-4 py-2 bg-[#242424] border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-[#68d570]"
                    />
                  </div>

                  {/* Form buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="flex-1 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !title.trim() || !description.trim()}
                      className="flex-1 py-2 green-btn text-black rounded-md font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </form>
              ) : (
                /* Feedback List */
                <div className="space-y-4">
                  {/* Add suggestion button */}
                  <button
                    onClick={() => setShowForm(true)}
                    className="w-full py-3 border-2 border-dashed border-gray-600 rounded-md text-gray-400 hover:border-[#68d570] hover:text-[#68d570] transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add a Suggestion
                  </button>

                  {/* Feedback items */}
                  {feedback === undefined ? (
                    <div className="text-center py-8 text-gray-500">Loading...</div>
                  ) : feedback.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      No suggestions yet. Be the first!
                    </div>
                  ) : (
                    feedback.map((item) => {
                      const typeConfig = getTypeConfig(item.type);
                      const hasVoted = item.upvoterIds.includes(visitorId);
                      const mergedRequests = item.mergedRequests || [];

                      return (
                        <div
                          key={item._id}
                          className="bg-[#242424] rounded-lg p-4 border border-gray-700"
                        >
                          <div className="flex gap-4">
                            {/* Upvote button */}
                            <button
                              onClick={() => handleUpvote(item._id, hasVoted)}
                              className={`flex flex-col items-center gap-1 px-2 py-1 rounded transition-colors ${
                                hasVoted
                                  ? 'text-[#68d570]'
                                  : 'text-gray-400 hover:text-[#68d570]'
                              }`}
                            >
                              <svg
                                className="w-5 h-5"
                                fill={hasVoted ? 'currentColor' : 'none'}
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M5 15l7-7 7 7"
                                />
                              </svg>
                              <span className="text-sm font-medium">{item.upvotes}</span>
                            </button>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span
                                  className={`px-2 py-0.5 text-xs font-medium rounded-full ${typeConfig.color} text-white`}
                                >
                                  {typeConfig.label}
                                </span>
                                {item.status !== 'pending' && (
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                    item.status === 'completed'
                                      ? 'bg-green-600 text-white'
                                      : item.status === 'planned'
                                      ? 'bg-purple-600 text-white'
                                      : 'bg-gray-600 text-gray-300'
                                  }`}>
                                    {item.status === 'completed' ? '✓ shipped' : item.status}
                                  </span>
                                )}
                              </div>
                              <h3 className="text-white font-medium mb-1">{item.title}</h3>
                              <p className="text-gray-400 text-sm">{item.description}</p>
                              {mergedRequests.length > 0 && (
                                <div className="mt-3 rounded-md border border-gray-700 bg-[#1f1f1f] p-3">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                                    Also requested as
                                  </div>
                                  <div className="space-y-2">
                                    {mergedRequests.map((request) => (
                                      <div
                                        key={request._id}
                                        className="border-l-2 border-[#68d570]/60 pl-3"
                                      >
                                        <div className="text-sm text-gray-200">
                                          {request.title}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          {request.authorName || 'Anonymous'} •{' '}
                                          {new Date(request.createdAt).toLocaleDateString()}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="mt-2 text-xs text-gray-500">
                                {item.authorName || 'Anonymous'} •{' '}
                                {new Date(item.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 pt-4 border-t border-gray-700 bg-[#1a1a1a]">
              <button
                onClick={onClose}
                className="w-full py-3 bg-gray-700 text-white rounded-md font-semibold hover:bg-gray-600 transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
