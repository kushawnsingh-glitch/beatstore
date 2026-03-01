import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, RotateCcw, DollarSign, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SiteHeader } from '@/components/site-header';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

// Define defaults once — easy to maintain
const DEFAULT_PRICES = {
  Basic: 29.99,
  Premium: 39.99,
  Professional: 59.99,
  Legacy: 99.99,
  Exclusive: 299.99,
};

const LICENSE_TYPES = [
  { type: 'Basic', default: 29.99, label: 'Basic Lease' },
  { type: 'Premium', default: 39.99, label: 'Premium Lease' },
  { type: 'Professional', default: 59.99, label: 'Professional' },
  { type: 'Legacy', default: 99.99, label: 'Legacy' },
  { type: 'Exclusive', default: 299.99, label: 'Exclusive' },
];

const AdminBeatPricing = () => {
  const [prices, setPrices] = useState<Record<string, number>>(
    LICENSE_TYPES.reduce(
      (acc, { type, default: def }) => ({ ...acc, [type]: def }),
      {},
    ),
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const resetToDefaults = () => {
    setPrices({ ...DEFAULT_PRICES });
    toast.success('Prices reset to defaults');
  };

  const handleChange = (type: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0) {
      setPrices((prev) => ({ ...prev, [type]: num }));
    }
  };

  const handleSubmit = async () => {
    if (Object.values(prices).some((p) => p <= 0)) {
      toast.error('All prices must be greater than 0');
      return;
    }

    setLoading(true);
    setResult(null);

    toast.promise(
      fetch(
        `${import.meta.env.VITE_API_BASE_URL_BACKEND}/api/bulk-update-prices`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prices }),
        },
      )
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Update failed');
          }
          return res.json();
        })
        .then((data) => {
          setResult(data);
          toast.success('All beat license prices updated!');
        }),
      {
        loading: 'Updating prices across all beats...',
        success: 'Prices updated successfully',
        error: (err) => err.message || 'Failed to update prices',
      },
    );

    setLoading(false);
  };

  return (
    <SidebarProvider
      className="!z-50 !relative"
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title="Global Beat Pricing" />

        <div className="container mx-auto p-6 max-w-5xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">
              Update License Prices
            </h1>
            <p className="text-muted-foreground mt-2">
              Change the price for each license type — this will update{' '}
              <strong>every existing beat</strong> in the database.
            </p>
          </div>

          <Alert variant="destructive" className="mb-8">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle>Irreversible bulk action</AlertTitle>
            <AlertDescription>
              This updates prices on <strong>all beats at once</strong>. There
              is no undo. Make sure you're sure!
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>License Prices (USD)</CardTitle>
              <CardDescription>
                Enter new prices — these will apply globally
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {LICENSE_TYPES.map(({ type, label }) => (
                <div key={type} className="space-y-2">
                  <Label htmlFor={`price-${type}`} className="font-medium">
                    {label} ({type})
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id={`price-${type}`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={prices[type]}
                      onChange={(e) => handleChange(type, e.target.value)}
                      className="pl-9"
                      disabled={loading}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
            <CardFooter className="flex justify-end gap-4 border-t pt-6">
              <Button
                variant="outline"
                onClick={resetToDefaults}
                disabled={loading}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset to Defaults
              </Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Apply to All Beats
              </Button>
            </CardFooter>
          </Card>

          {result && (
            <div className="mt-8">
              <Card>
                <CardHeader>
                  <CardTitle>Update Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <dt className="font-medium">Matched documents</dt>
                    <dd>{result.matched}</dd>
                    <dt className="font-medium">Modified documents</dt>
                    <dd>{result.modified}</dd>
                  </dl>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AdminBeatPricing;
