// Tremor Drawer [v1.0.0]

import * as React from "react"
import * as DrawerPrimitives from "@radix-ui/react-dialog"
import { RiCloseLine } from "@remixicon/react"

import { cx } from "@/lib/cx"
import { focusRing } from "@/lib/focusRing"

const Drawer = (
  props: React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Root>,
) => {
  return <DrawerPrimitives.Root {...props} />
}
Drawer.displayName = "Drawer"

const DrawerTrigger = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Trigger>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Trigger>
>(({ className, ...props }, ref) => {
  return (
    <DrawerPrimitives.Trigger ref={ref} className={cx(className)} {...props} />
  )
})
DrawerTrigger.displayName = "DrawerTrigger"

const DrawerClose = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Close>
>(({ className, ...props }, ref) => {
  return (
    <DrawerPrimitives.Close ref={ref} className={cx(className)} {...props} />
  )
})
DrawerClose.displayName = "DrawerClose"

const DrawerPortal = DrawerPrimitives.Portal
DrawerPortal.displayName = "DrawerPortal"

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Overlay>
>(({ className, ...props }, forwardedRef) => {
  return (
    <DrawerPrimitives.Overlay
      ref={forwardedRef}
      className={cx(
        "fixed inset-0 z-50 overflow-y-auto",
        "bg-black/30",
        "data-[state=closed]:animate-hide data-[state=open]:animate-dialog-overlay-show",
        className,
      )}
      {...props}
      style={{
        animationDuration: "300ms",
        animationFillMode: "backwards",
      }}
    />
  )
})
DrawerOverlay.displayName = "DrawerOverlay"

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Content>
>(({ className, ...props }, forwardedRef) => {
  return (
    <DrawerPortal>
      <DrawerOverlay>
        <DrawerPrimitives.Content
          ref={forwardedRef}
          className={cx(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l p-6 shadow-xl focus:outline-hidden sm:max-w-xl",
            "border-gray-200 dark:border-gray-800",
            "bg-white dark:bg-gray-950",
            "data-[state=closed]:animate-drawer-hide data-[state=open]:animate-drawer-show",
            focusRing,
            className,
          )}
          {...props}
        />
      </DrawerOverlay>
    </DrawerPortal>
  )
})
DrawerContent.displayName = "DrawerContent"

const DrawerHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ children, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className="flex items-start justify-between gap-x-4 border-b border-gray-200 pb-4 dark:border-gray-800"
      {...props}
    >
      <div className={cx("flex flex-col gap-y-1", className)}>
        {children}
      </div>
      <DrawerPrimitives.Close asChild>
        <button className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300">
          <RiCloseLine className="size-5" aria-hidden="true" />
        </button>
      </DrawerPrimitives.Close>
    </div>
  )
})
DrawerHeader.displayName = "DrawerHeader"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Title>
>(({ className, ...props }, forwardedRef) => (
  <DrawerPrimitives.Title
    ref={forwardedRef}
    className={cx(
      "text-lg font-semibold",
      "text-gray-900 dark:text-gray-50",
      className,
    )}
    {...props}
  />
))
DrawerTitle.displayName = "DrawerTitle"

const DrawerBody = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cx("flex-1 overflow-y-auto py-4", className)} {...props} />
})
DrawerBody.displayName = "DrawerBody"

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Description>
>(({ className, ...props }, forwardedRef) => {
  return (
    <DrawerPrimitives.Description
      ref={forwardedRef}
      className={cx("text-sm text-gray-500 dark:text-gray-400", className)}
      {...props}
    />
  )
})
DrawerDescription.displayName = "DrawerDescription"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cx(
        "flex flex-col-reverse border-t border-gray-200 pt-4 sm:flex-row sm:justify-end sm:space-x-2 dark:border-gray-800",
        className,
      )}
      {...props}
    />
  )
}
DrawerFooter.displayName = "DrawerFooter"

export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
}
