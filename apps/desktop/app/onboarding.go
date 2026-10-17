package app

// The window until the agent's service runs: it looks for Node.js, which the
// service runs on, offers to install Ji Agent's own when there is none new
// enough, then starts the service. What fails says so, with a way to try
// again, rather than the app quitting before it shows.

import (
	"context"
	"fmt"
	"time"

	"github.com/egoist/mygo/ui"

	"desktop/nodejs"
	"desktop/ui/components"
	"desktop/ui/icons"
)

// Onboarding is the window before the service runs; main gives it the steps
// and swaps in the App once Ready.
type Onboarding struct {
	// Find returns the Node.js to run the service on, "" when there is none
	// new enough.
	Find func() string
	// Install downloads Ji Agent's own Node.js, saying how much has come, and
	// returns its executable.
	Install func(ctx context.Context, progress func(done, total int64)) (string, error)
	// Start starts the service on node and returns its address.
	Start func(node string) (string, error)
	// Ready runs once the service listens, with its address.
	Ready func(url string)
	// Version is the Node.js that Install installs, and Where where to.
	Version, Where string
	// Settings choose the theme, as the App's do.
	Settings Settings

	update func(fn func())
	async  func(fn func())
	look

	step onboardingStep
	// The Node.js found or installed, once there is one.
	node string
	// The download going on, the bar that shows it, and what stops it.
	progress download
	bar      components.Progress
	cancel   context.CancelFunc
	// What failed, once step is failed.
	problem string
}

type onboardingStep int

const (
	finding onboardingStep = iota
	missing
	downloading
	starting
	failed
)

func NewOnboarding(update func(func())) *Onboarding {
	return &Onboarding{
		update:   update,
		async:    func(fn func()) { go fn() },
		Settings: DefaultSettings,
	}
}

// Begin looks for Node.js, and starts the service on what it finds.
func (o *Onboarding) Begin() {
	o.step, o.problem = finding, ""
	o.async(func() {
		node := o.Find()
		o.update(func() {
			if node == "" {
				o.step = missing
				return
			}
			o.start(node)
		})
	})
}

func (o *Onboarding) install() {
	ctx, cancel := context.WithCancel(context.Background())
	o.step = downloading
	o.progress, o.bar, o.cancel = download{}, components.Progress{}, cancel

	o.async(func() {
		// Every percent is enough to draw, not every read of the download
		shown, began := int64(-1), time.Now()
		node, err := o.Install(ctx, func(done, total int64) {
			if percent := done * 100 / max(total, 1); percent != shown {
				shown = percent
				elapsed := time.Since(began)
				o.update(func() { o.progress = download{done, total, elapsed} })
			}
		})

		cancelled := ctx.Err() != nil
		cancel()
		o.update(func() {
			switch {
			case cancelled:
				o.step = missing
			case err != nil:
				o.fail("Node.js could not be installed: " + err.Error())
			default:
				o.start(node)
			}
		})
	})
}

func (o *Onboarding) start(node string) {
	o.node, o.step = node, starting
	o.async(func() {
		url, err := o.Start(node)
		o.update(func() {
			if err != nil {
				o.fail("The agent did not start: " + err.Error())
				return
			}
			o.Ready(url)
		})
	})
}

func (o *Onboarding) fail(problem string) { o.step, o.problem = failed, problem }

// retry does again what failed: start the service on the Node.js there is,
// or look for one.
func (o *Onboarding) retry() {
	if o.node != "" {
		o.start(o.node)
		return
	}
	o.Begin()
}

func (o *Onboarding) View(c *ui.Context) {
	o.look.apply(c, &o.Settings)
	p := components.PaletteOf(c.Theme())

	c.Root().Background(p.Background)
	ui.Column(c).Fill().Children(func() {
		ui.Box(c).Height(TitleBarHeight).Shrink(0).DragWindow()
		ui.Column(c).Grow(1).Center().Gap(24).Padding(0, 48, 48+TitleBarHeight).Children(func() {
			switch o.step {
			case finding:
				waiting(c, "Looking for Node.js…")
			case starting:
				waiting(c, "Starting the agent…")
			case missing:
				o.missing(c, p)
			case downloading:
				o.downloading(c, p)
			case failed:
				o.failed(c)
			}
		})
	})
}

func waiting(c *ui.Context, label string) {
	p := components.PaletteOf(c.Theme())
	ui.Column(c).Gap(8).AlignItems(ui.Center).Children(func() {
		components.Spinner(c, label, 16, ui.Color{})
		ui.Text(c, label).TextColor(p.MutedForeground)
	})
}

func (o *Onboarding) missing(c *ui.Context, p *components.Palette) {
	why := fmt.Sprintf(
		"The agent runs on Node.js %d or later, which this Mac does not have. Ji Agent can download a copy of its own, kept apart from any Node.js you install.",
		nodejs.MinMajor,
	)
	components.EmptyHeader(c, icons.Download, "Ji Agent needs Node.js", why)

	ui.Row(c).Gap(8).Children(func() {
		if components.Button(c, "Install Node.js", components.ButtonStyle{Icon: icons.Download}).
			Clicked() {
			o.install()
		}
		if components.Button(c, "Check Again", components.ButtonStyle{Variant: components.Outline}).
			Tooltip("Once you have installed Node.js yourself").Clicked() {
			o.Begin()
		}
	})

	ui.Column(c).Gap(2).AlignItems(ui.Center).Children(func() {
		for _, line := range []string{
			"Node.js " + o.Version + " from nodejs.org, about 50 MB, into",
			o.Where,
		} {
			ui.Text(c, line).
				TextColor(p.MutedForeground).
				FontSize(components.TextXS(c.Theme())).
				TextAlign(ui.Center)
		}
	})
}

func (o *Onboarding) downloading(c *ui.Context, p *components.Palette) {
	d := o.progress
	value, status := -1.0, "Connecting to nodejs.org…"
	switch {
	case d.unpacking():
		value, status = 1, "Unpacking…"
	case d.total > 0:
		value, status = float64(d.done)/float64(d.total), d.megabytes()
		if left := d.remaining(); left != "" {
			status += " · " + left
		}
	}

	ui.Column(c).Width(360).Gap(10).Children(func() {
		ui.Row(c).AlignItems(ui.Center).Children(func() {
			ui.Text(c, "Installing Node.js "+o.Version).FontWeight(500).Grow(1)
			if value >= 0 {
				ui.Text(c, fmt.Sprintf("%d%%", int(value*100))).
					TextColor(p.MutedForeground).
					FontFeatures("tnum")
			}
		})

		o.bar.Bar(c, "Downloading Node.js", value, d.unpacking())

		// As tall as the button, so the row keeps its height once it goes
		ui.Row(c).Height(24).AlignItems(ui.Center).Children(func() {
			ui.Text(c, status).
				TextColor(p.MutedForeground).
				FontSize(components.TextXS(c.Theme())).
				FontFeatures("tnum").
				Grow(1)
			if d.unpacking() {
				return
			}
			cancel := components.ButtonStyle{
				Variant: components.Ghost,
				Size:    components.SizeExtraSmall,
			}
			if components.Button(c, "Cancel", cancel).Clicked() {
				o.cancel()
			}
		})
	})
}

func (o *Onboarding) failed(c *ui.Context) {
	components.EmptyHeader(c, icons.TriangleAlert, "Ji Agent could not start", o.problem)
	if components.Button(c, "Try Again", components.ButtonStyle{Icon: icons.RefreshCw}).Clicked() {
		o.retry()
	}
}

// download is how much of Node.js has come, of total bytes, and in how
// long; total is 0 until the download says how big it is.
type download struct {
	done, total int64
	elapsed     time.Duration
}

// unpacking is whether all of it has come and Install is unpacking it, which
// takes a moment of unknown length and cannot be cancelled.
func (d download) unpacking() bool { return d.total > 0 && d.done >= d.total }

// megabytes is how much of total has come: "21.4 of 52.9 MB".
func (d download) megabytes() string {
	return fmt.Sprintf("%.1f of %.1f MB", float64(d.done)/1e6, float64(d.total)/1e6)
}

// remaining is how long the rest will take at the speed so far, "" until a
// second of it has given a speed to go by.
func (d download) remaining() string {
	if d.elapsed < time.Second || d.done == 0 || d.done >= d.total {
		return ""
	}

	left := time.Duration(float64(d.total-d.done) / float64(d.done) * float64(d.elapsed))
	switch {
	case left < 5*time.Second:
		return "a few seconds left"
	case left < time.Minute:
		return fmt.Sprintf("about %d seconds left", int(left.Seconds()+0.5))
	default:
		return fmt.Sprintf("about %d min left", int(left.Minutes()+0.5))
	}
}
