import { fireEvent, screen } from '@testing-library/react-native';

import { PrivacyScreen } from '@/features/privacy/privacy-screen';

import { createTestSession, renderWithSession } from './ledger-session';

jest.mock('@react-native-community/datetimepicker', () => () => null);

describe('Privacy screen (ADR-017)', () => {
  it('crash reports are off by default and toggle only when the user asks', async () => {
    const ts = createTestSession();
    const { refresh } = await renderWithSession(<PrivacyScreen />, ts);
    expect(screen.getByText(/does not connect to the internet/)).toBeOnTheScreen();
    const toggle = screen.getByTestId('crash-toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
    expect(ts.session.settings.crashReports).toBe(false);
    await fireEvent.press(toggle);
    expect(ts.session.settings.crashReports).toBe(true);
    await refresh();
    expect(screen.getByTestId('crash-toggle').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('builds without a crash-reporting DSN hide the switch', async () => {
    const ts = createTestSession();
    await renderWithSession(<PrivacyScreen />, {
      ...ts,
      session: { ...ts.session, crashReportsAvailable: false },
    });
    expect(screen.queryByTestId('crash-toggle')).toBeNull();
    expect(screen.getByTestId('crash-unavailable')).toBeOnTheScreen();
  });

  it('Arabic', async () => {
    const ts = createTestSession({ locale: 'ar' });
    await renderWithSession(<PrivacyScreen />, ts, 'ar');
    expect(screen.getByText(/لا يتصل التطبيق بالإنترنت/)).toBeOnTheScreen();
  });
});
