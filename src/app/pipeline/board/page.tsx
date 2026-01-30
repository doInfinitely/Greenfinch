'use client';

import AppSidebar from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/lib/schema';

const BOARD_COLUMNS: PipelineStatus[] = ['new', 'qualified', 'attempted_contact', 'active_opportunity', 'won', 'lost'];

const COLUMN_COLORS: Record<PipelineStatus, string> = {
  new: 'border-t-gray-400',
  qualified: 'border-t-blue-500',
  attempted_contact: 'border-t-yellow-500',
  active_opportunity: 'border-t-purple-500',
  won: 'border-t-green-500',
  lost: 'border-t-red-500',
  disqualified: 'border-t-orange-500',
};

export default function PipelineBoard() {
  return (
    <AppSidebar>
      <div className="h-full bg-gray-50 p-6 overflow-x-auto">
        <div className="max-w-full">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Pipeline Board</h1>
          
          <div className="flex gap-4 min-w-max pb-4">
            {BOARD_COLUMNS.map((status) => (
              <div key={status} className="w-72 flex-shrink-0">
                <Card className={`border-t-4 ${COLUMN_COLORS[status]}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      {PIPELINE_STATUS_LABELS[status]}
                      <span className="text-muted-foreground font-normal">0</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-[400px]">
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground">
                        No properties
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppSidebar>
  );
}
