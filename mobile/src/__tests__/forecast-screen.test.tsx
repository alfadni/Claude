import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ForecastScreen from '@/app/index';
import { formatDate, formatUsd } from '@/lib/format';
import { isoDay, jsonResponse, makeForecast } from '@/test-utils/fixtures';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

let fetchMock: jest.SpyInstance;

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ForecastScreen />
    </SafeAreaProvider>,
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const horizonOf = (url: string) => Number(new URL(url).searchParams.get('horizon'));

beforeEach(async () => {
  await AsyncStorage.clear();
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
});

describe('ForecastScreen', () => {
  it('happy path: shows price, forecast summary, backtest and disclaimer', async () => {
    const res = deferred<Response>();
    fetchMock.mockReturnValue(res.promise);
    await renderScreen();

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.getByTestId('disclaimer')).toHaveTextContent(/Not financial advice/);
    res.resolve(jsonResponse(makeForecast({ lastClose: 0.5123 })));

    expect(await screen.findByTestId('last-close')).toHaveTextContent('$0.5123');
    expect(screen.getByText(`Forecast for ${formatDate(isoDay(30))}`)).toBeTruthy();
    expect(screen.getByTestId('backtest')).toBeTruthy();
    expect(screen.queryByTestId('stale')).toBeNull();
    expect(screen.queryByTestId('refresh-failed')).toBeNull();
    expect(screen.getByTestId('disclaimer')).toHaveTextContent(/Not financial advice/);
    expect(horizonOf(fetchMock.mock.calls[0][0])).toBe(30);
  });

  it('switching horizon fetches that horizon', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      jsonResponse(makeForecast({ horizon: horizonOf(url) })),
    );
    await renderScreen();
    await screen.findByTestId('last-close');

    await fireEvent.press(screen.getByLabelText('Forecast 1 year ahead'));
    expect(await screen.findByText(`Forecast for ${formatDate(isoDay(365))}`)).toBeTruthy();
    expect(horizonOf(fetchMock.mock.calls.at(-1)[0])).toBe(365);
  });

  it('a slow response for the old horizon never overwrites the new one', async () => {
    const slow30 = deferred<Response>();
    fetchMock.mockImplementation((url: string) =>
      horizonOf(url) === 30 ? slow30.promise : Promise.resolve(jsonResponse(makeForecast({ horizon: 7 }))),
    );
    await renderScreen();

    await fireEvent.press(screen.getByLabelText('Forecast 7 days ahead'));
    expect(await screen.findByText(`Forecast for ${formatDate(isoDay(7))}`)).toBeTruthy();

    slow30.resolve(jsonResponse(makeForecast({ horizon: 30 })));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(`Forecast for ${formatDate(isoDay(7))}`)).toBeTruthy();
    expect(screen.queryByText(`Forecast for ${formatDate(isoDay(30))}`)).toBeNull();
  });

  it('offline with no saved forecast: error with retry, then recovers', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await renderScreen();

    expect(await screen.findByTestId('error')).toHaveTextContent(/offline/);
    expect(screen.queryByTestId('last-close')).toBeNull();
    expect(screen.getByTestId('disclaimer')).toHaveTextContent(/Not financial advice/);

    fetchMock.mockResolvedValueOnce(jsonResponse(makeForecast()));
    await fireEvent.press(screen.getByText('Retry'));
    expect(await screen.findByTestId('last-close')).toBeTruthy();
    expect(screen.queryByTestId('error')).toBeNull();
  });

  it('offline with a saved forecast: shows it, labelled as saved', async () => {
    const saved = makeForecast({ lastClose: 0.4321 });
    const savedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    await AsyncStorage.setItem('forecast:v1:ensemble:30', JSON.stringify({ data: saved, savedAt }));
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();

    expect(await screen.findByTestId('refresh-failed')).toHaveTextContent(/Showing forecast saved 3 h ago/);
    expect(screen.getByTestId('last-close')).toHaveTextContent(formatUsd(0.4321));
    expect(screen.queryByTestId('error')).toBeNull();
  });

  it('a corrupted saved forecast is discarded, not shown', async () => {
    const bad = { ...makeForecast(), forecast: [] };
    await AsyncStorage.setItem(
      'forecast:v1:ensemble:30',
      JSON.stringify({ data: bad, savedAt: new Date().toISOString() }),
    );
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();

    expect(await screen.findByTestId('error')).toBeTruthy();
    expect(await AsyncStorage.getItem('forecast:v1:ensemble:30')).toBeNull();
  });

  it('successful loads are saved for offline use', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeForecast()));
    await renderScreen();
    await screen.findByTestId('last-close');
    await waitFor(async () => expect(await AsyncStorage.getItem('forecast:v1:ensemble:30')).not.toBeNull());
  });

  it('price feed down (503): explains and suggests when to retry', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'upstream_unavailable' } }, 503, { 'Retry-After': '60' }),
    );
    await renderScreen();
    expect(await screen.findByTestId('error')).toHaveTextContent(
      /temporarily unavailable\. Try again in about a minute/,
    );
  });

  it('an incomplete response is rejected, never drawn', async () => {
    const f = makeForecast();
    f.forecast[10].p25 = f.forecast[10].p75 * 2; // crossed quantiles
    fetchMock.mockResolvedValue(jsonResponse(f));
    await renderScreen();
    expect(await screen.findByTestId('error')).toHaveTextContent(/incomplete/);
    expect(screen.queryByTestId('forecast-summary')).toBeNull();
  });

  it('server-flagged stale data is shown with a warning', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeForecast({
          stale: true,
          stale_reason: 'Latest price refresh failed; serving the last good data.',
        }),
      ),
    );
    await renderScreen();
    expect(await screen.findByTestId('stale')).toHaveTextContent(/refresh failed/);
    expect(screen.getByTestId('last-close')).toBeTruthy();
  });

  it('old prices are flagged stale even if the server does not say so', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeForecast({ asOfOffset: -5 })));
    await renderScreen();
    expect(await screen.findByTestId('stale')).toHaveTextContent(
      new RegExp(`The latest price is from ${formatDate(isoDay(-5))}`),
    );
  });

  it('a failed refresh keeps the current forecast on screen', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeForecast({ lastClose: 0.6 })));
    await renderScreen();
    await screen.findByTestId('last-close');

    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    // RN's Jest mock of RefreshControl renders no props, but keeps the instance.
    const pull = (RefreshControl as unknown as { latestRef: { props: { onRefresh: () => void } } }).latestRef;
    await act(async () => pull.props.onRefresh()); // pull to refresh

    expect(await screen.findByTestId('refresh-failed')).toHaveTextContent(/Couldn't refresh/);
    expect(screen.getByTestId('last-close')).toHaveTextContent(formatUsd(0.6));
  });
});
