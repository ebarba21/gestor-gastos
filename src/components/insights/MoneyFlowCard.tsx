// Flujo del dinero del mes (Sankey): de donde viene (ingresos, devoluciones y Bizums, ahorros
// previos si se gasta de mas) y a donde va (categorias, ahorro, inversion, sin gastar). Solo en
// pantallas anchas: en un movil un Sankey no se lee.
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from 'recharts';
import type { MoneyFlow, SankeyNode } from '../../services/insightsService';
import { formatCents } from '../../lib/money';
import { useChartColors, type ChartColors } from '../dashboard/chartTheme';

interface MoneyFlowCardProps {
  flow: MoneyFlow;
  categoryColors: Map<string, string>;
}

function nodeColor(n: SankeyNode, colors: ChartColors, categoryColors: Map<string, string>): string {
  switch (n.kind) {
    case 'source':
      return colors.income;
    case 'hub':
      return colors.axis;
    case 'savings':
      return colors.saved;
    case 'investment':
      return colors.invested;
    case 'free':
      return colors.savings;
    case 'category':
      return (n.categoryId && categoryColors.get(n.categoryId)) || colors.expense;
    default:
      return colors.axis;
  }
}

interface NodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: SankeyNode & { value: number };
}

export function MoneyFlowCard({ flow, categoryColors }: MoneyFlowCardProps) {
  const colors = useChartColors();
  if (flow.links.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Sin flujo de dinero que mostrar este mes.</p>;
  }
  const renderNode = (props: unknown) => {
    const { x, y, width, height, index, payload } = props as NodeProps;
    const isSource = payload.kind === 'source';
    const textX = isSource ? x - 6 : x + width + 6;
    return (
      <Layer key={`node-${index}`}>
        <Rectangle x={x} y={y} width={width} height={height} fill={nodeColor(payload, colors, categoryColors)} fillOpacity={0.9} />
        <text
          x={textX}
          y={y + height / 2}
          textAnchor={isSource ? 'end' : 'start'}
          dominantBaseline="middle"
          fontSize={11}
          fill={colors.axis}
        >
          {payload.name} · {formatCents(payload.value)}
        </text>
      </Layer>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={Math.max(260, flow.nodes.length * 28)}>
      <Sankey
        data={{ nodes: flow.nodes, links: flow.links }}
        node={renderNode}
        nodePadding={14}
        nodeWidth={10}
        margin={{ top: 8, right: 170, bottom: 8, left: 150 }}
        link={{ stroke: colors.axis, strokeOpacity: 0.25 }}
        iterations={32}
      >
        <Tooltip
          content={({ active, payload }) => {
            const p = active && payload && payload[0] ? (payload[0].payload as { payload?: { source?: SankeyNode; target?: SankeyNode; value?: number; name?: string } }) : null;
            const inner = p?.payload;
            if (!inner) return null;
            const title = inner.source && inner.target ? `${inner.source.name} → ${inner.target.name}` : inner.name ?? '';
            return (
              <div className="rounded-lg border px-3 py-2 text-xs" style={{ backgroundColor: colors.tooltipBg, borderColor: colors.tooltipBorder }}>
                <span className="text-slate-400">{title}: </span>
                <span className="font-medium text-slate-100">{formatCents(inner.value ?? 0)}</span>
              </div>
            );
          }}
        />
      </Sankey>
    </ResponsiveContainer>
  );
}
