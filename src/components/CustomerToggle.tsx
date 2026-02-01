'use client';

import { Building2, UserCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface CustomerToggleProps {
  propertyId: string;
  onToggle?: (isCustomer: boolean) => void;
}

export default function CustomerToggle({ propertyId, onToggle }: CustomerToggleProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading: isLoadingQuery } = useQuery<{ isCurrentCustomer: boolean }>({
    queryKey: ['/api/properties', propertyId, 'customer'],
    queryFn: () => fetch(`/api/properties/${propertyId}/customer`).then(r => r.json()),
  });

  const mutation = useMutation({
    mutationFn: async (isCurrentCustomer: boolean) => {
      const response = await fetch(`/api/properties/${propertyId}/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCurrentCustomer }),
      });
      if (!response.ok) {
        throw new Error('Failed to update customer status');
      }
      return response.json();
    },
    onSuccess: (_, isCurrentCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties', propertyId, 'customer'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties/search'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties', propertyId, 'pipeline'] });
      onToggle?.(isCurrentCustomer);
      toast({
        title: isCurrentCustomer ? 'Marked as Customer' : 'Removed Customer Status',
        description: isCurrentCustomer 
          ? 'This property is now marked as an existing customer.'
          : 'This property is no longer marked as a customer.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update customer status. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const isCustomer = data?.isCurrentCustomer ?? false;
  const isLoading = isLoadingQuery || mutation.isPending;

  const handleToggle = () => {
    mutation.mutate(!isCustomer);
  };

  return (
    <Button
      variant={isCustomer ? 'default' : 'outline'}
      size="sm"
      onClick={handleToggle}
      disabled={isLoading}
      data-testid="button-toggle-customer"
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
      ) : isCustomer ? (
        <UserCheck className="w-4 h-4 mr-1.5" />
      ) : (
        <Building2 className="w-4 h-4 mr-1.5" />
      )}
      {isCustomer ? 'Customer' : 'Mark as Customer'}
    </Button>
  );
}
