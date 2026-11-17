import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from './AuthContext';
import WakeUpBanner from '../../components/WakeUpBanner';
import { Loader2 } from 'lucide-react';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState('');

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      await login(data.email, data.password);
      navigate(from || '/', { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { message?: string; response?: { data?: { detail?: string } } };
      if (axiosErr.response?.data?.detail) {
        setServerError(axiosErr.response.data.detail);
      } else if (axiosErr.message === 'Network Error' || !axiosErr.response) {
        setServerError('Cannot reach the server right now. Please check your connection and try again.');
      } else {
        setServerError('Unable to sign in. Check your email and password and try again.');
      }
    }
  };

  return (
    <div className="w-full min-h-screen flex flex-col lg:flex-row overflow-x-hidden">
      {/* ── Left Red Gradient Panel ── */}
      <section
        className="flex-1 flex flex-col justify-center gap-7 text-white"
        style={{
          background: 'linear-gradient(150deg, #C2330F, #8E1D0B)',
          padding: '72px',
          minHeight: '400px',
        }}
      >
        <div style={{ font: '800 28px Inter', letterSpacing: '-0.02em' }}>SafeCircle</div>
        <h1 style={{ font: '800 52px/1.1 Inter', letterSpacing: '-0.02em' }}>Help is one tap away.</h1>
        <p style={{ font: '500 18px/1.5 Inter', maxWidth: '460px', opacity: 0.95 }}>
          Alert your guardian, society security and nearby volunteers in seconds, and follow every step until you are safe.
        </p>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            font: '600 16px Inter',
          }}
        >
          <li>One-tap SOS with live location</li>
          <li>Verified guardians alerted first</li>
          <li>Real-time incident tracking</li>
        </ul>
      </section>

      {/* ── Right White Form Panel ── */}
      <section
        className="w-full lg:w-[560px] shrink-0 bg-white flex items-center justify-center p-8 sm:p-12"
      >
        <form
          onSubmit={handleSubmit(onSubmit)}
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          <h2 style={{ font: '800 32px Inter', color: '#1A1A2E', letterSpacing: '-0.02em' }}>Welcome back</h2>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '-6px' }}>
            Log in to your community account.
          </p>

          <WakeUpBanner />

          {serverError && (
            <div
              style={{
                background: '#FEE2E2',
                color: '#991B1B',
                border: '1px solid #FCA5A5',
                borderRadius: '12px',
                padding: '10px 14px',
                fontSize: '13px',
                fontWeight: 600,
              }}
              role="alert"
            >
              {serverError}
            </div>
          )}

          <div>
            <div className="lbl">Email</div>
            <input
              type="email"
              autoComplete="email"
              placeholder="asha@example.com"
              className={`fld ${errors.email ? 'border-critical' : ''}`}
              {...register('email')}
            />
            {errors.email && (
              <p style={{ color: '#D92D20', fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <div className="lbl">Password</div>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••"
              className={`fld ${errors.password ? 'border-critical' : ''}`}
              {...register('password')}
            />
            {errors.password && (
              <p style={{ color: '#D92D20', fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>
                {errors.password.message}
              </p>
            )}
          </div>

          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              alert('Please contact your society security desk or administrator to reset your credentials.');
            }}
            style={{
              font: '700 13px Inter',
              color: '#B93412',
              textAlign: 'right',
              textDecoration: 'none',
              marginTop: '-4px',
            }}
          >
            Forgot password?
          </a>

          <button
            className="btn"
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: '16px',
              width: '100%',
              fontSize: '15px',
            }}
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Log in'}
          </button>

          <p style={{ font: '500 14px Inter', color: '#5B5B6B', textAlign: 'center', marginTop: '6px' }}>
            New here?{' '}
            <Link to="/register" style={{ color: '#B93412', fontWeight: 700, textDecoration: 'none' }}>
              Create an account
            </Link>
          </p>

          <p style={{ font: '500 12px/1.5 Inter', color: '#5B5B6B', textAlign: 'center', marginTop: '4px' }}>
            Residents, guardians, volunteers and security staff all sign in here.
          </p>
        </form>
      </section>
    </div>
  );
}
