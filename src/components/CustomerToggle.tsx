'use client';

import { Building2, UserCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface CustomerToggleProps {
  propertyId: string;
  onToggle?: (isCustomer: boolean) => void;
  initialIsCustomer?: boolean;
  initialLoaded?: boolean;
}

interface SearchResult {
  properties: Array<{ propertyKey: string; isCurrentCustomer: boolean; [key: string]: unknown }>;
  total: number;
  hasMore: boolean;
}

export default function CustomerToggle({ propertyId, onToggle, initialIsCustomer, initialLoaded }: CustomerToggleProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading: isLoadingQuery } = useQuery<{ isCurrentCustomer: boolean }>({
    queryKey: ['/api/properties', propertyId, 'customer'],
    queryFn: () => fetch(`/api/properties/${propertyId}/customer`).then(r => r.json()),
    initialData: initialLoaded ? { isCurrentCustomer: initialIsCustomer ?? false } : undefined,
    staleTime: initialLoaded ? 30000 : 0,
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
    onMutate: async (isCurrentCustomer: boolean) => {
      await queryClient.cancelQueries({ queryKey: ['/api/properties', propertyId, 'customer'] });
      
      const previousCustomerData = queryClient.getQueryData<{ isCurrentCustomer: boolean }>(
        ['/api/properties', propertyId, 'customer']
      );
      
      queryClient.setQueryData(['/api/properties', propertyId, 'customer'], { isCurrentCustomer });
      
      queryClient.setQueriesData<SearchResult>(
        { queryKey: ['/api/properties/search'], exact: false },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            properties: old.properties.map((p) =>
              p.propertyKey === propertyId ? { ...p, isCurrentCustomer } : p
            ),
          };
        }
      );
      
      return { previousCustomerData };
    },
    onError: (_, __, context) => {
      if (context?.previousCustomerData) {
        queryClient.setQueryData(
          ['/api/properties', propertyId, 'customer'],
          context.previousCustomerData
        );
      }
      queryClient.invalidateQueries({ queryKey: ['/api/properties/search'], exact: false });
      toast({
        title: 'Error',
        description: 'Failed to update customer status. Please try again.',
        variant: 'destructive',
      });
    },
    onSuccess: (_, isCurrentCustomer) => {
      onToggle?.(isCurrentCustomer);
      toast({
        title: isCurrentCustomer ? 'Marked as Customer' : 'Removed Customer Status',
        description: isCurrentCustomer 
          ? 'This property is now marked as an existing customer.'
          : 'This property is no longer marked as a customer.',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties', propertyId, 'customer'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties', propertyId, 'pipeline'] });
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
