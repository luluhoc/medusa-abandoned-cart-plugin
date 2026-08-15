import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ShoppingCart } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Select,
  StatusBadge,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { sdk } from "../../lib/sdk"

const PAGE_SIZE = 20

type AbandonedCart = {
  id: string
  cart_id: string
  email: string | null
  currency_code: string | null
  item_count: number
  subtotal: number | null
  status: string
  stage_index: number
  cart_updated_at: string
  last_notified_at: string | null
  recovered_at: string | null
  converted_at: string | null
  order_id: string | null
}

type ListResponse = {
  abandoned_carts: AbandonedCart[]
  count: number
  limit: number
  offset: number
}

type StatsResponse = {
  stats: {
    counts: Record<string, number>
    total: number
    notified: number
    recovery_rate: number
    conversion_rate: number
    recovered_value: { currency_code: string; amount: number }[]
  }
  config: {
    enabled: boolean
    stages: { id: string; delay_ms: number; template: string; channel: string }[]
  }
}

const STATUS_COLORS: Record<
  string,
  "green" | "red" | "blue" | "orange" | "grey" | "purple"
> = {
  pending: "grey",
  notified: "blue",
  recovered: "orange",
  converted: "green",
  dismissed: "grey",
  expired: "red",
}

const STATUS_OPTIONS = [
  "all",
  "pending",
  "notified",
  "recovered",
  "converted",
  "dismissed",
  "expired",
]

const formatMoney = (amount: number | null, currency: string | null) => {
  if (amount === null || amount === undefined) {
    return "—"
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(Number(amount))
  } catch {
    return `${Number(amount).toFixed(2)} ${(currency || "").toUpperCase()}`
  }
}

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—"

const formatDelay = (ms: number) => {
  const hours = ms / (60 * 60 * 1000)

  if (hours < 1) {
    return `${Math.round(ms / (60 * 1000))}m`
  }

  return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`
}

const AbandonedCartsPage = () => {
  const queryClient = useQueryClient()
  const [pageIndex, setPageIndex] = useState(0)
  const [status, setStatus] = useState("all")

  const listQuery = useQuery<ListResponse>({
    queryKey: ["abandoned-carts", pageIndex, status],
    queryFn: () =>
      sdk.client.fetch<ListResponse>("/admin/abandoned-carts", {
        query: {
          limit: PAGE_SIZE,
          offset: pageIndex * PAGE_SIZE,
          order: "-cart_updated_at",
          ...(status === "all" ? {} : { status }),
        },
      }),
  })

  const statsQuery = useQuery<StatsResponse>({
    queryKey: ["abandoned-carts", "stats"],
    queryFn: () => sdk.client.fetch<StatsResponse>("/admin/abandoned-carts/stats"),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["abandoned-carts"] })

  const sweepMutation = useMutation({
    mutationFn: () =>
      sdk.client.fetch("/admin/abandoned-carts/sweep", { method: "POST" }),
    onSuccess: (data: any) => {
      const sweep = data?.sweep ?? {}
      toast.success(
        `Sweep done — ${sweep.created ?? 0} new, ${sweep.sent ?? 0} notified`
      )
      invalidate()
    },
    onError: (error: any) =>
      toast.error(error?.message ?? "The sweep could not be started."),
  })

  const sendMutation = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/abandoned-carts/${id}/send`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (data: any) => {
      if (data?.result?.failed) {
        toast.error("The provider rejected the notification. Check the logs.")
      } else if (data?.result?.sent) {
        toast.success("Reminder sent.")
      } else {
        toast.info("Nothing left to send for this cart.")
      }
      invalidate()
    },
    onError: (error: any) =>
      toast.error(error?.message ?? "The reminder could not be sent."),
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/abandoned-carts/${id}`, {
        method: "POST",
        body: { status: "dismissed" },
      }),
    onSuccess: () => {
      toast.success("Cart dismissed — it will no longer be chased.")
      invalidate()
    },
    onError: (error: any) =>
      toast.error(error?.message ?? "The cart could not be dismissed."),
  })

  const pageCount = Math.max(
    1,
    Math.ceil((listQuery.data?.count ?? 0) / PAGE_SIZE)
  )

  const summary = useMemo(() => {
    const stats = statsQuery.data?.stats

    if (!stats) {
      return []
    }

    return [
      { label: "Tracked", value: String(stats.total) },
      { label: "Notified", value: String(stats.notified) },
      {
        label: "Returned",
        value: `${Math.round(stats.recovery_rate * 100)}%`,
      },
      {
        label: "Converted",
        value: `${Math.round(stats.conversion_rate * 100)}%`,
      },
      {
        label: "Recovered value",
        value: stats.recovered_value.length
          ? stats.recovered_value
              .map((entry) => formatMoney(entry.amount, entry.currency_code))
              .join(" · ")
          : "—",
      },
    ]
  }, [statsQuery.data])

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
        <div>
          <Heading level="h2">Abandoned carts</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {statsQuery.data?.config.enabled === false
              ? "The scheduled sweep is disabled in the plugin options."
              : statsQuery.data?.config.stages
                  .map(
                    (stage) =>
                      `${stage.id} after ${formatDelay(stage.delay_ms)}`
                  )
                  .join(" → ") ?? "Loading sequence…"}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value)
              setPageIndex(0)
            }}
          >
            <Select.Trigger className="w-40">
              <Select.Value placeholder="Status" />
            </Select.Trigger>
            <Select.Content>
              {STATUS_OPTIONS.map((option) => (
                <Select.Item key={option} value={option}>
                  {option === "all" ? "All statuses" : option}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Button
            variant="secondary"
            isLoading={sweepMutation.isPending}
            onClick={() => sweepMutation.mutate()}
          >
            <ArrowPath />
            Run sweep
          </Button>
        </div>
      </div>

      {summary.length > 0 && (
        <div className="grid grid-cols-2 gap-px bg-ui-border-base md:grid-cols-5">
          {summary.map((entry) => (
            <div key={entry.label} className="bg-ui-bg-base px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {entry.label}
              </Text>
              <Heading level="h3">{entry.value}</Heading>
            </div>
          ))}
        </div>
      )}

      <div>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Email</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Items</Table.HeaderCell>
              <Table.HeaderCell>Subtotal</Table.HeaderCell>
              <Table.HeaderCell>Stage</Table.HeaderCell>
              <Table.HeaderCell>Last activity</Table.HeaderCell>
              <Table.HeaderCell>Last reminder</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {listQuery.data?.abandoned_carts.map((record) => (
              <Table.Row key={record.id}>
                <Table.Cell>
                  <div className="flex flex-col">
                    <Text size="small">{record.email ?? "—"}</Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {record.cart_id}
                    </Text>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge color={STATUS_COLORS[record.status] ?? "grey"}>
                    {record.status}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>{record.item_count}</Table.Cell>
                <Table.Cell>
                  {formatMoney(record.subtotal, record.currency_code)}
                </Table.Cell>
                <Table.Cell>
                  {record.stage_index} /{" "}
                  {statsQuery.data?.config.stages.length ?? "—"}
                </Table.Cell>
                <Table.Cell>{formatDate(record.cart_updated_at)}</Table.Cell>
                <Table.Cell>{formatDate(record.last_notified_at)}</Table.Cell>
                <Table.Cell>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={
                        sendMutation.isPending || record.status === "converted"
                      }
                      onClick={() => sendMutation.mutate(record.id)}
                    >
                      Send now
                    </Button>
                    <Button
                      size="small"
                      variant="transparent"
                      disabled={
                        dismissMutation.isPending ||
                        record.status === "dismissed" ||
                        record.status === "converted"
                      }
                      onClick={() => dismissMutation.mutate(record.id)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {(listQuery.isLoading || !listQuery.data?.abandoned_carts.length) && (
          <div className="px-6 py-8">
            <Text size="small" className="text-ui-fg-subtle">
              {listQuery.isLoading
                ? "Loading…"
                : "No abandoned carts match this filter yet."}
            </Text>
          </div>
        )}

        <Table.Pagination
          count={listQuery.data?.count ?? 0}
          pageSize={PAGE_SIZE}
          pageIndex={pageIndex}
          pageCount={pageCount}
          canPreviousPage={pageIndex > 0}
          canNextPage={pageIndex + 1 < pageCount}
          previousPage={() => setPageIndex((index) => Math.max(0, index - 1))}
          nextPage={() => setPageIndex((index) => index + 1)}
        />
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Abandoned carts",
  icon: ShoppingCart,
})

export default AbandonedCartsPage
