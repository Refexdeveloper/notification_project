import { useNavigate } from 'react-router-dom';
import Layout from '@/components/feature/Layout';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Layout title="Page Not Found">
      <div className="flex flex-col items-center justify-center py-24">
        <div className="w-20 h-20 rounded-2xl bg-background-100 flex items-center justify-center mb-5">
          <span className="text-3xl text-foreground-300">
            <i className="ri-error-warning-line"></i>
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-foreground-950 mb-2">Page not found</h1>
        <p className="text-sm text-foreground-500 mb-6">The page you are looking for does not exist or has been moved.</p>
        <button
          onClick={() => navigate('/applications')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
        >
          Back to Applications
        </button>
      </div>
    </Layout>
  );
}